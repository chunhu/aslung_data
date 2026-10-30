import {randomUUID} from 'node:crypto';
import {parseImportTable} from './fleet-import.mjs';
import {FleetError,previewFleetImport,applyFleetImport} from './fleet-store.mjs';
import {normalizeFleetSchedule,nextFleetSchedule,fleetScheduleLabel} from './fleet-schedule.mjs';
export function ensureFleetSyncSchema(d){
  d.exec(`CREATE TABLE IF NOT EXISTS fleet_sync_sources(
    id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,headers_json TEXT NOT NULL,mapping_json TEXT NOT NULL,
    only_aslung INTEGER NOT NULL,enabled INTEGER NOT NULL,interval_mins INTEGER NOT NULL,
    next_check TEXT NOT NULL,last_check TEXT,last_success TEXT,last_status TEXT,last_message TEXT,
    updated_by TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS fleet_sync_runs(id INTEGER PRIMARY KEY,source_id TEXT NOT NULL,
    status TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);`);
  const columns=d.prepare('PRAGMA table_info(fleet_sync_sources)').all();
  for(const [name,definition] of [['schedule_type',"TEXT NOT NULL DEFAULT 'interval'"],['schedule_time',"TEXT NOT NULL DEFAULT '02:00'"],['schedule_days',"TEXT NOT NULL DEFAULT '1,2,3,4,5'"]])if(!columns.some(c=>c.name===name))d.exec(`ALTER TABLE fleet_sync_sources ADD COLUMN ${name} ${definition}`);
}
function admin(d,email){if(!d.prepare("SELECT 1 FROM members WHERE email=? AND active=1 AND role='admin'").get(email))throw new FleetError('排程管理員帳號已停用或權限已變更。',403);}
export function fleetGoogleUrl(value){
  let u;try{u=new URL(value);}catch{throw new FleetError('請貼上 Google 試算表網址。');}
  const id=u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1],gid=u.searchParams.get('gid')||new URLSearchParams(u.hash.slice(1)).get('gid');
  if(u.protocol!=='https:'||u.hostname!=='docs.google.com'||!id||!gid||!/^\d+$/.test(gid))throw new FleetError('請使用 docs.google.com 試算表分頁網址，並包含 gid。');
  return {url:`https://docs.google.com/spreadsheets/d/${id}/edit?gid=${gid}`,exportUrl:`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`};
}
export async function fetchFleetCsv(url,fetcher=fetch){
  const res=await fetcher(fleetGoogleUrl(url).exportUrl,{signal:AbortSignal.timeout(20000),cache:'no-store'});
  if(!res.ok)throw new FleetError(`無法讀取試算表（HTTP ${res.status}），請確認該分頁可供伺服器讀取。`);
  const reader=res.body?.getReader();if(!reader)throw new FleetError('無法取得 CSV 內容。');
  const decoder=new TextDecoder();let text='',size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000)throw new FleetError('試算表超過 2 MB，請分批處理。');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}
  if(!text.trim()||/^\s*(?:<!doctype html|<html)/i.test(text))throw new FleetError('無法取得 CSV，請確認分享設定，或下載 CSV 後上傳。');
  return text;
}
export function saveFleetSchedule(d,p,actor){
  // Called inside the import transaction: saving the schedule and importing are atomic.
  admin(d,actor);const config=normalizeFleetSchedule(p.schedule),interval=config.interval,url=fleetGoogleUrl(p.schedule.url).url;
  if(typeof p.schedule.enabled!=='boolean')throw new FleetError('定期同步設定不正確。');
  const old=d.prepare('SELECT * FROM fleet_sync_sources WHERE url=?').get(url);
  if(old?.lease_until>Date.now())throw new FleetError('此試算表正在同步，請稍後再匯入。',409);
  const table=parseImportTable(p.text),mapping=p.mapping||table.mapping;
  const id=old?.id||randomUUID(),next=nextFleetSchedule(config);
  d.prepare(`INSERT INTO fleet_sync_sources(id,url,headers_json,mapping_json,only_aslung,enabled,interval_mins,next_check,updated_by)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET headers_json=excluded.headers_json,mapping_json=excluded.mapping_json,
    only_aslung=excluded.only_aslung,enabled=excluded.enabled,interval_mins=excluded.interval_mins,next_check=excluded.next_check,
    updated_by=excluded.updated_by,revision=fleet_sync_sources.revision+1`).run(id,url,JSON.stringify(table.headers),JSON.stringify(mapping),p.onlyAslung!==false?1:0,p.schedule.enabled?1:0,interval,next,actor);
  d.prepare('UPDATE fleet_sync_sources SET schedule_type=?,schedule_time=?,schedule_days=? WHERE id=?').run(config.type,config.time,config.days,id);
  d.prepare("INSERT INTO fleet_sync_runs(source_id,status,message,created_at) VALUES(?,'SETTINGS',?,?)").run(id,`管理員 ${actor} 儲存排程：${p.schedule.enabled?'啟用':'停用'}；${fleetScheduleLabel(config)}`,new Date().toISOString());
  return id;
}
export function fleetSyncState(d){ensureFleetSyncSchema(d);return {sources:d.prepare('SELECT * FROM fleet_sync_sources ORDER BY url').all(),runs:d.prepare('SELECT * FROM fleet_sync_runs ORDER BY id DESC LIMIT 30').all()};}
export function updateFleetSchedule(d,p,actor){
  ensureFleetSyncSchema(d);const config=normalizeFleetSchedule(p),interval=config.interval;if(typeof p.enabled!=='boolean'||typeof p.id!=='string'||!Number.isSafeInteger(p.revision))throw new FleetError('排程設定不正確。');
  d.exec('BEGIN IMMEDIATE');try{
    admin(d,actor);const s=d.prepare('SELECT * FROM fleet_sync_sources WHERE id=?').get(p.id);if(!s||s.revision!==p.revision)throw new FleetError('排程已異動，請重新整理。',409);
    d.prepare('UPDATE fleet_sync_sources SET enabled=?,interval_mins=?,next_check=?,updated_by=?,schedule_type=?,schedule_time=?,schedule_days=?,revision=revision+1 WHERE id=?').run(p.enabled?1:0,interval,nextFleetSchedule(config),actor,config.type,config.time,config.days,s.id);
    d.prepare("INSERT INTO fleet_sync_runs(source_id,status,message,created_at) VALUES(?,'SETTINGS',?,?)").run(s.id,`管理員 ${actor} 更新排程：${p.enabled?'啟用':'停用'}；${fleetScheduleLabel(config)}`,new Date().toISOString());
    d.exec('COMMIT');return {ok:true};
  }catch(e){d.exec('ROLLBACK');throw e;}
}
export async function syncFleetSchedule(d,id,fetchCsv=fetchFleetCsv){
  ensureFleetSyncSchema(d);const owner=randomUUID(),now=new Date().toISOString();
  const s=d.prepare('UPDATE fleet_sync_sources SET lease=?,lease_until=? WHERE id=? AND enabled=1 AND next_check<=? AND lease_until<=? RETURNING *').get(owner,Date.now()+120000,id,now,Date.now());
  if(!s)return {status:'SKIPPED'};
  const next=()=>nextFleetSchedule(normalizeFleetSchedule({scheduleType:s.schedule_type,scheduleTime:s.schedule_time,scheduleDays:s.schedule_days,intervalMins:s.interval_mins}));
  const verify=()=>{admin(d,s.updated_by);const live=d.prepare('SELECT * FROM fleet_sync_sources WHERE id=?').get(id);if(!live.enabled||live.revision!==s.revision||live.lease!==owner||live.lease_until<=Date.now())throw new FleetError('同步期間排程已異動，本次不套用。',409);};
  try{
    verify();const text=await fetchCsv(s.url),table=parseImportTable(text);
    if(JSON.stringify(table.headers)!==s.headers_json)throw new FleetError('試算表欄位已變更，請重新開啟同步試算表、對應欄位並確認匯入。');
    const input={text,mapping:JSON.parse(s.mapping_json),onlyAslung:!!s.only_aslung},preview=previewFleetImport(d,input);
    if(!preview.canApply)throw new FleetError('同步未套用，請修正試算表：\n'+(preview.issues.filter(i=>i.level==='error').map(i=>`第 ${i.row} 列：${i.message}`).join('\n')||'沒有可匯入的設備紀錄。'));
    const result=applyFleetImport(d,{...input,fingerprint:preview.fingerprint},'scheduler:'+s.updated_by,{beforeCommit:()=>{
      verify();const finished=new Date().toISOString(),message=`新增 ${preview.added} 筆、更新 ${preview.updated} 筆、不變 ${preview.unchanged} 筆；提醒 ${preview.issues.filter(i=>i.level==='warning').length} 項`;
      d.prepare("UPDATE fleet_sync_sources SET last_check=?,last_success=?,last_status='SUCCESS',last_message=?,next_check=? WHERE id=?").run(finished,finished,message,next(),id);
      d.prepare("INSERT INTO fleet_sync_runs(source_id,status,message,created_at) VALUES(?,'SUCCESS',?,?)").run(id,message,finished);
    }});
    return {status:'SUCCESS',...result};
  }catch(e){
    const live=d.prepare('SELECT revision,lease FROM fleet_sync_sources WHERE id=?').get(id);
    if(live?.lease===owner){
      const message=String(e.message),finished=new Date().toISOString();
      if(live.revision===s.revision)d.prepare("UPDATE fleet_sync_sources SET last_check=?,last_status='FAILED',last_message=?,next_check=? WHERE id=?").run(finished,message,next(),id);
      d.prepare("INSERT INTO fleet_sync_runs(source_id,status,message,created_at) VALUES(?,'FAILED',?,?)").run(id,message,finished);
    }
    return {status:'FAILED',message:String(e.message)};
  }finally{d.prepare('UPDATE fleet_sync_sources SET lease=NULL,lease_until=0 WHERE id=? AND lease=?').run(id,owner);}
}
