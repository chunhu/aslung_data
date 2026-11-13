import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
export const RETENTION_DAYS=90;
export const VISIT_WINDOW_MS=30*60*1000;
import {VISIT_PATHS} from './activity-paths.mjs';
export {VISIT_PATHS};
export class ActivityError extends Error{constructor(status,message){super(message);this.status=status;}}
const hash=value=>createHash('sha256').update(value).digest('hex');
const clean=(value,max=254)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max):'';
export function clientIp(request,{trustProxy=process.env.TRUST_PROXY_HEADERS==='1'}={}){if(!trustProxy)return '';const value=(request.headers.get('x-forwarded-for')?.split(',')[0]||request.headers.get('x-real-ip')||'').trim();return isIP(value)?value:'';}
export function ensureActivitySchema(d){
  d.exec(`CREATE TABLE IF NOT EXISTS activity_events(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,event TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT '',target TEXT NOT NULL DEFAULT '',outcome TEXT NOT NULL,ip TEXT NOT NULL DEFAULT '',user_agent TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_time ON activity_events(created_at,id);
    CREATE INDEX IF NOT EXISTS activity_kind_time ON activity_events(kind,created_at,id);
    CREATE INDEX IF NOT EXISTS activity_actor_time ON activity_events(actor,created_at,id);
    CREATE TABLE IF NOT EXISTS activity_daily(day TEXT NOT NULL,kind TEXT NOT NULL,event TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,kind,event));
    CREATE TABLE IF NOT EXISTS activity_visitors(id TEXT PRIMARY KEY,last_seen INTEGER NOT NULL,last_path TEXT NOT NULL,last_view INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_visitor_seen ON activity_visitors(last_seen);
    CREATE TABLE IF NOT EXISTS activity_daily_visitors(day TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(day,id));
    CREATE TABLE IF NOT EXISTS activity_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity_rate(key TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);`);
  d.prepare("INSERT OR IGNORE INTO activity_state VALUES('started_at',?)").run(new Date().toISOString());
}
function dayKey(now){return new Date(now+8*3600000).toISOString().slice(0,10);}
function count(d,day,kind,event){d.prepare('INSERT INTO activity_daily VALUES(?,?,?,1) ON CONFLICT(day,kind,event) DO UPDATE SET count=count+1').run(day,kind,event);}
// No FK to members: deleting an account must not erase its audit trail.
export function recordActivity(d,{kind,event,actor='',target='',outcome='success',ip='',userAgent=''},now=Date.now()){
  if(!['auth','visit','operation','download'].includes(kind)||!['success','failure'].includes(outcome))throw new ActivityError(400,'紀錄類型不正確。');
  d.prepare('INSERT INTO activity_events(kind,event,actor,target,outcome,ip,user_agent,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(kind,clean(event,100),clean(actor),clean(target,160),outcome,isIP(ip)?ip:'',clean(userAgent,255),new Date(now).toISOString());
  count(d,dayKey(now),kind,outcome);
}
export function limitActivity(d,key,maximum,now=Date.now()){
  const window=Math.floor(now/60000),id=hash(key);
  d.prepare('DELETE FROM activity_rate WHERE window<?').run(window-1);
  d.prepare('INSERT INTO activity_rate VALUES(?,?,0) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count ELSE 0 END,window=excluded.window').run(id,window);
  if(!d.prepare('UPDATE activity_rate SET count=count+1 WHERE key=? AND count<? RETURNING count').get(id,maximum))throw new ActivityError(429,'要求過於頻繁，請稍後再試。');
}
export function recordVisit(d,{path,visitor,email='',...info},now=Date.now()){
  if(!VISIT_PATHS.includes(path)||typeof visitor!=='string'||visitor.length>300)throw new ActivityError(400,'瀏覽頁面不正確。');
  const id=hash(visitor),day=dayKey(now);
  d.exec('BEGIN IMMEDIATE');try{
    const previous=d.prepare('SELECT * FROM activity_visitors WHERE id=?').get(id);
    // Suppress duplicate beacons/Strict Mode replays and rapid refreshes.
    if(previous&&previous.last_path===path&&now-previous.last_view<3000){d.exec('COMMIT');return {counted:false,newVisit:false};}
    const newVisit=!previous||now-previous.last_seen>=VISIT_WINDOW_MS;
    d.prepare('INSERT INTO activity_visitors VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,last_path=excluded.last_path,last_view=excluded.last_view').run(id,now,path,now);
    recordActivity(d,{kind:'visit',event:'page.view',actor:email,target:path,...info},now);
    if(newVisit)count(d,day,'stats','visits');
    if(d.prepare('INSERT OR IGNORE INTO activity_daily_visitors VALUES(?,?)').run(day,id).changes)count(d,day,'stats','visitors');
    d.prepare("INSERT INTO site_stats VALUES('total_views',1,?) ON CONFLICT(key) DO UPDATE SET value=value+1,updated_at=excluded.updated_at").run(new Date(now).toISOString());
    d.exec('COMMIT');return {counted:true,newVisit};
  }catch(e){d.exec('ROLLBACK');throw e;}
}
export function pruneActivity(d,now=Date.now()){
  const next=Number(d.prepare("SELECT value FROM activity_state WHERE key='next_cleanup'").get()?.value||0);if(next>now)return;
  const cutoff=new Date(now-RETENTION_DAYS*86400000).toISOString();let more=false;
  for(const table of ['activity_events','login_logs','site_visit_logs']){
    if(!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    const result=d.prepare(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE created_at<? ORDER BY created_at LIMIT 1000)`).run(cutoff);more ||= result.changes===1000;
  }
  const visitorsRemoved=d.prepare('DELETE FROM activity_visitors WHERE id IN (SELECT id FROM activity_visitors WHERE last_seen<? LIMIT 1000)').run(now-RETENTION_DAYS*86400000).changes;more ||= visitorsRemoved===1000;
  const dailyRemoved=d.prepare('DELETE FROM activity_daily_visitors WHERE rowid IN (SELECT rowid FROM activity_daily_visitors WHERE day<? LIMIT 1000)').run(dayKey(now-RETENTION_DAYS*86400000)).changes;more ||= dailyRemoved===1000;
  d.prepare("INSERT INTO activity_state VALUES('next_cleanup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(more?now:now+3600000));
}
export function queryActivity(d,{kind='',q='',from='',to='',before=0}={},now=Date.now()){
  if(kind&&!['auth','visit','operation','download'].includes(kind))throw new ActivityError(400,'紀錄類型不正確。');
  if(typeof q!=='string'||q.length>160||!Number.isSafeInteger(before)||before<0)throw new ActivityError(400,'搜尋條件不正確。');
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  from ||= dayKey(now-6*86400000);to ||= dayKey(now);
  if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>=RETENTION_DAYS*86400000)throw new ActivityError(400,'請選擇不超過 90 天的有效日期範圍。');
  const start=new Date(Date.parse(from+'T00:00:00+08:00')).toISOString(),end=new Date(Date.parse(to+'T00:00:00+08:00')+86400000).toISOString();
  const where=['created_at>=?','created_at<?'],args=[start,end];
  if(kind){where.push('kind=?');args.push(kind);}if(q.trim()){where.push('(instr(lower(actor),lower(?))>0 OR instr(lower(event),lower(?))>0 OR instr(ip,?)>0)');args.push(q.trim(),q.trim(),q.trim());}
  if(before){where.push('id<?');args.push(before);}
  const rows=d.prepare(`SELECT * FROM activity_events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 51`).all(...args);
  const next=rows.length>50?rows[49].id:null;
  return {rows:rows.slice(0,50),next,from,to,retentionDays:RETENTION_DAYS,startedAt:d.prepare("SELECT value FROM activity_state WHERE key='started_at'").get()?.value,
    daily:d.prepare('SELECT * FROM activity_daily WHERE day>=? AND day<=? ORDER BY day DESC,kind,event').all(from,to)};
}
