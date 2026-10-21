import {randomUUID} from 'node:crypto';

export class HoboError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
export function hoboSerial(value){
  if(typeof value!=='string'||!/^\d{1,30}$/.test(value))throw new HoboError(400,'請輸入 HOBO Logger Serial Number（數字序號）。');
  return value;
}
export function hoboInstant(value){
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw new HoboError(400,'日期必須包含時區。');
  return new Date(Math.floor(Date.parse(value)/1000)*1000).toISOString();
}
export function hoboRange(start,end){
  start=hoboInstant(start);end=hoboInstant(end);
  if(start>end)throw new HoboError(400,'開始時間不能晚於結束時間。');
  return {start,end};
}
export function ensureHoboSchema(d){
  d.exec(`CREATE TABLE IF NOT EXISTS hobo_loggers (
    serial TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,
    sync_from TEXT NOT NULL,synced_until TEXT,next_sync INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS hobo_jobs (
    id TEXT PRIMARY KEY,serial TEXT NOT NULL REFERENCES hobo_loggers(serial),start TEXT NOT NULL,end TEXT NOT NULL,
    cursor TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'QUEUED',lease_until INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT NOT NULL DEFAULT '',next_attempt INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,
    observations INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',actor TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS hobo_one_active ON hobo_jobs(serial) WHERE status IN ('QUEUED','RUNNING');
    CREATE TABLE IF NOT EXISTS hobo_observations (
    logger_sn TEXT NOT NULL,sensor_sn TEXT NOT NULL,timestamp TEXT NOT NULL,data_type TEXT NOT NULL,
    data_type_id TEXT NOT NULL,value REAL,unit TEXT NOT NULL,sensor_measurement_type TEXT NOT NULL,
    PRIMARY KEY(logger_sn,timestamp,sensor_sn,data_type_id,sensor_measurement_type,unit));
    CREATE INDEX IF NOT EXISTS hobo_staging_time ON hobo_observations(timestamp);
    CREATE TABLE IF NOT EXISTS hobo_revisions(serial TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS hobo_service_state(name TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hobo_operation(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,until INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS hobo_archives(serial TEXT NOT NULL,day TEXT NOT NULL,bucket TEXT NOT NULL,region TEXT NOT NULL,
      key TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,count INTEGER NOT NULL,latest TEXT NOT NULL,PRIMARY KEY(serial,day));
    CREATE TABLE IF NOT EXISTS hobo_archive_scopes(serial TEXT NOT NULL,day TEXT NOT NULL,bucket TEXT NOT NULL,region TEXT NOT NULL,
      PRIMARY KEY(serial,day,bucket,region));
    CREATE TABLE IF NOT EXISTS hobo_cleanup_plans(id TEXT PRIMARY KEY,actor TEXT NOT NULL,expires INTEGER NOT NULL,
      payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PREVIEW',created_at TEXT NOT NULL,backup_path TEXT);
    CREATE TABLE IF NOT EXISTS hobo_cleanup_items(id TEXT PRIMARY KEY,plan TEXT NOT NULL,serial TEXT NOT NULL,day TEXT NOT NULL,
      scopes TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'QUEUED',attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '');`);
}
export function hoboRevision(d,serial){d.prepare('INSERT INTO hobo_revisions(serial,revision) VALUES(?,1) ON CONFLICT(serial) DO UPDATE SET revision=revision+1').run(serial);}
export function hoboDeleting(d,serial){return !!d.prepare("SELECT 1 FROM hobo_cleanup_items WHERE serial=? AND status!='DONE'").get(serial);}
export function requireHoboWritable(d,serial){if(hoboDeleting(d,serial))throw new HoboError(409,'此設備正在清除資料，完成前暫停同步與修改。');}
export async function withHoboLock(d,work,now=Date.now()){
  ensureHoboSchema(d);const owner=randomUUID();
  const result=d.prepare(`INSERT INTO hobo_operation(id,owner,until) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until=excluded.until WHERE hobo_operation.until<=?`).run(owner,now+1800000,now);
  if(!result.changes)return null;
  const heartbeat=()=>{
    if(!d.prepare('UPDATE hobo_operation SET until=? WHERE id=1 AND owner=?').run(Date.now()+1800000,owner).changes)throw new HoboError(409,'HOBO 工作鎖已變更，請重試。');
  };
  try{return await work(heartbeat);}finally{d.prepare('DELETE FROM hobo_operation WHERE id=1 AND owner=?').run(owner);}
}
export function hoboStatus(d){
  ensureHoboSchema(d);
  return {configured:!!process.env.LICOR_API_TOKEN?.trim(),storage:process.env.HOBO_STORAGE||'local',storage_error:d.prepare("SELECT value FROM hobo_service_state WHERE name='storage_error'").get()?.value||'',
    loggers:d.prepare(`SELECT l.*,(SELECT COUNT(*) FROM hobo_observations o WHERE o.logger_sn=l.serial) AS observations,
      (SELECT COALESCE(SUM(count),0) FROM hobo_archives a WHERE a.serial=l.serial) AS archived,
      MAX(COALESCE((SELECT MAX(timestamp) FROM hobo_observations o WHERE o.logger_sn=l.serial),''),
      COALESCE((SELECT MAX(latest) FROM hobo_archives a WHERE a.serial=l.serial),'')) AS latest FROM hobo_loggers l ORDER BY serial`).all(),
    jobs:d.prepare('SELECT id,serial,start,end,cursor,status,observations,error,created_at FROM hobo_jobs ORDER BY created_at DESC LIMIT 30').all()};
}
export function saveHoboLogger(d,{serial,name,start,enabled}){
  ensureHoboSchema(d);serial=hoboSerial(serial);start=hoboInstant(start);
  requireHoboWritable(d,serial);
  if(typeof name!=='string'||!name.trim()||name.length>120||typeof enabled!=='boolean')throw new HoboError(400,'設備名稱或同步設定不正確。');
  d.prepare(`INSERT INTO hobo_loggers(serial,name,sync_from,enabled) VALUES(?,?,?,?)
    ON CONFLICT(serial) DO UPDATE SET name=excluded.name,enabled=excluded.enabled`).run(serial,name.trim(),start,Number(enabled));
}
export function queueHoboSync(d,{serial,start,end,actor='schedule'}){
  ensureHoboSchema(d);serial=hoboSerial(serial);({start,end}=hoboRange(start,end));
  requireHoboWritable(d,serial);
  if(!d.prepare('SELECT 1 FROM hobo_loggers WHERE serial=?').get(serial))throw new HoboError(404,'尚未新增此 HOBO 設備。');
  if(d.prepare("SELECT 1 FROM hobo_jobs WHERE serial=? AND status IN ('QUEUED','RUNNING')").get(serial))throw new HoboError(409,'此設備已有同步工作，請等待完成。');
  const id=randomUUID();d.prepare('INSERT INTO hobo_jobs(id,serial,start,end,cursor,actor,created_at) VALUES(?,?,?,?,?,?,?)').run(id,serial,start,end,start,actor,new Date().toISOString());
  return id;
}
export function retryHoboSync(d,id){
  ensureHoboSchema(d);
  const job=d.prepare("SELECT * FROM hobo_jobs WHERE id=? AND status='FAILED'").get(id);
  if(!job)throw new HoboError(404,'找不到可重試的工作。');
  requireHoboWritable(d,job.serial);
  if(d.prepare("SELECT 1 FROM hobo_jobs WHERE serial=? AND status IN ('QUEUED','RUNNING')").get(job.serial))throw new HoboError(409,'此設備已有同步工作。');
  d.prepare("UPDATE hobo_jobs SET status='QUEUED',attempts=0,error='',next_attempt=0 WHERE id=?").run(id);
}

export function saveHoboBatch(d,{serials,start,end,enabled,queue=false,actor}){
  ensureHoboSchema(d);
  if(!Array.isArray(serials)||!serials.length||serials.length>100||typeof enabled!=='boolean'||typeof queue!=='boolean')throw new HoboError(400,'請提供 1 至 100 台設備序號及同步設定。');
  serials=[...new Set(serials.map(hoboSerial))];({start,end}=hoboRange(start,end));
  let queued=0,skipped=0;
  d.exec('BEGIN IMMEDIATE');
  try{
    for(const serial of serials){
      saveHoboLogger(d,{serial,name:`RCEC_${serial}`,start,enabled});
      if(queue){
        if(d.prepare("SELECT 1 FROM hobo_jobs WHERE serial=? AND status IN ('QUEUED','RUNNING')").get(serial))skipped++;
        else{queueHoboSync(d,{serial,start,end,actor});queued++;}
      }
    }
    d.exec('COMMIT');return {saved:serials.length,queued,skipped};
  }catch(e){d.exec('ROLLBACK');throw e;}
}

// The documented API has no pagination cursor. Split saturated windows instead of accepting truncated data.
export async function fetchHoboWindow({serial,start,end,token=process.env.LICOR_API_TOKEN,fetchImpl=fetch}){
  serial=hoboSerial(serial);({start,end}=hoboRange(start,end));
  if(!token?.trim())throw new HoboError(503,'尚未設定伺服器 LICOR_API_TOKEN。');
  const deadline=Date.now()+120000;let requests=0;
  async function load(a,b){
    if(++requests>256||Date.now()>=deadline)throw new HoboError(502,'此區間資料量過大，請縮短匯入範圍。');
    const url=new URL('https://api.licor.cloud/v1/data');
    url.search=new URLSearchParams({loggers:serial,start_date_time:new Date(a).toISOString().slice(0,19).replace('T',' '),end_date_time:new Date(b).toISOString().slice(0,19).replace('T',' ')}).toString();
    let response;
    try{response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token.trim()}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(Math.min(30000,Math.max(1,deadline-Date.now()))) });}
    catch{throw new HoboError(502,'LI-COR 連線失敗或逾時，請稍後重試。');}
    if(!response.ok)throw new HoboError([429,509].includes(response.status)?429:502,[401,403].includes(response.status)?'LI-COR Token 無效或沒有此設備的存取權限。':`LI-COR 回應 HTTP ${response.status}，請稍後重試。`);
    let body;try{body=await response.json();}catch{throw new HoboError(502,'LI-COR 回傳的資料格式不正確。');}
    if(!body||typeof body.max_results!=='boolean'||!Array.isArray(body.data))throw new HoboError(502,'LI-COR 回傳缺少 data 或 max_results。');
    if(body.max_results){
      if(b-a<=1000)throw new HoboError(502,'單秒資料仍達 LI-COR 上限，未寫入不完整的資料。請聯絡 LI-COR 確認下載方式。');
      const middle=Math.floor((a+b)/2000)*1000;
      return [...await load(a,middle),...await load(middle,b)];
    }
    return body.data.map(row=>{
      if(!row||String(row.logger_sn)!==serial)throw new HoboError(502,'LI-COR 回傳設備序號不符。');
      let time=typeof row.timestamp==='string'?row.timestamp.replace(' ','T'):row.timestamp;
      // The upstream contract uses UTC; timestamps without an offset are interpreted as UTC.
      if(typeof time==='string'&&!/(Z|[+-]\d\d:\d\d)$/.test(time))time+='Z';
      let timestamp;try{hoboInstant(time);timestamp=new Date(time).toISOString();}catch{throw new HoboError(502,'LI-COR 回傳無效的時間。');}
      if(Date.parse(timestamp)<a||Date.parse(timestamp)>b)throw new HoboError(502,'LI-COR 回傳區間外的資料。');
      const text=key=>{if(typeof row[key]!=='string'&&typeof row[key]!=='number')throw new HoboError(502,`LI-COR 缺少 ${key}。`);return String(row[key]);};
      if(row.value!==null&&(typeof row.value!=='number'||!Number.isFinite(row.value)))throw new HoboError(502,'LI-COR 回傳無效的量測值。');
      return {logger_sn:serial,sensor_sn:text('sensor_sn'),timestamp,data_type:text('data_type'),data_type_id:text('data_type_id'),value:row.value,unit:text('unit'),sensor_measurement_type:text('sensor_measurement_type')};
    });
  }
  return load(Date.parse(start),Date.parse(end));
}

export async function runHoboSync(d,fetchWindow=fetchHoboWindow,now=Date.now()){
  return withHoboLock(d,heartbeat=>syncHoboInternal(d,fetchWindow,now,heartbeat),now);
}
async function syncHoboInternal(d,fetchWindow,now,heartbeat){
  ensureHoboSchema(d);
  if(!process.env.LICOR_API_TOKEN?.trim()&&fetchWindow===fetchHoboWindow)return null;
  d.exec('BEGIN IMMEDIATE');let job;
  try{
    // At most one LI-COR request chain across all worker processes.
    if(d.prepare("SELECT 1 FROM hobo_jobs WHERE status='RUNNING' AND lease_until>?").get(now)){d.exec('COMMIT');return null;}
    const due=d.prepare(`SELECT * FROM hobo_loggers l WHERE enabled=1 AND next_sync<=? AND NOT EXISTS
      (SELECT 1 FROM hobo_jobs j WHERE j.serial=l.serial AND j.status IN ('QUEUED','RUNNING')) ORDER BY next_sync LIMIT 1`).get(now);
    if(due){
      const start=due.synced_until?new Date(Math.max(Date.parse(due.sync_from),Date.parse(due.synced_until)-86400000)).toISOString():due.sync_from;
      if(Date.parse(start)<=now)queueHoboSync(d,{serial:due.serial,start,end:new Date(now).toISOString()});
      d.prepare('UPDATE hobo_loggers SET next_sync=? WHERE serial=?').run(now+3600000,due.serial);
    }
    const candidate=d.prepare(`SELECT * FROM hobo_jobs j WHERE status IN ('QUEUED','RUNNING') AND lease_until<=? AND next_attempt<=?
      AND NOT EXISTS(SELECT 1 FROM hobo_cleanup_items c WHERE c.serial=j.serial AND c.status!='DONE') ORDER BY next_attempt,created_at LIMIT 1`).get(now,now);
    if(candidate){job={...candidate,lease_token:randomUUID()};d.prepare("UPDATE hobo_jobs SET status='RUNNING',lease_until=?,lease_token=? WHERE id=?").run(now+300000,job.lease_token,job.id);}
    d.exec('COMMIT');
  }catch(e){d.exec('ROLLBACK');throw e;}
  if(!job)return null;
  const end=new Date(Math.min(Date.parse(job.end),Date.parse(job.cursor)+86400000)).toISOString();
  try{
    const rows=await fetchWindow({serial:job.serial,start:job.cursor,end});
    heartbeat();
    d.exec('BEGIN IMMEDIATE');
    try{
      if(!d.prepare("SELECT 1 FROM hobo_jobs WHERE id=? AND lease_token=? AND status='RUNNING'").get(job.id,job.lease_token)){d.exec('ROLLBACK');return null;}
      const insert=d.prepare(`INSERT INTO hobo_observations(logger_sn,sensor_sn,timestamp,data_type,data_type_id,value,unit,sensor_measurement_type)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(logger_sn,timestamp,sensor_sn,data_type_id,sensor_measurement_type,unit)
        DO UPDATE SET value=excluded.value,data_type=excluded.data_type`);
      for(const row of rows)insert.run(row.logger_sn,row.sensor_sn,row.timestamp,row.data_type,row.data_type_id,row.value,row.unit,row.sensor_measurement_type);
      hoboRevision(d,job.serial);
      const done=end===job.end;
      d.prepare("UPDATE hobo_jobs SET cursor=?,status=?,lease_until=0,observations=observations+?,attempts=0,error='',next_attempt=? WHERE id=?").run(end,done?'DONE':'QUEUED',rows.length,now,job.id);
      // A manual import of a later interval must not skip earlier unsynchronized history.
      if(done)d.prepare(`UPDATE hobo_loggers SET synced_until=CASE WHEN synced_until IS NULL OR synced_until<? THEN ? ELSE synced_until END
        WHERE serial=? AND ?<=COALESCE(synced_until,sync_from)`).run(end,end,job.serial,job.start);
      d.exec('COMMIT');return {id:job.id,status:done?'DONE':'QUEUED'};
    }catch(e){d.exec('ROLLBACK');throw e;}
  }catch(e){
    const attempts=job.attempts+1;
    const error=e instanceof HoboError?e.message:'HOBO 同步失敗，未推進此區間，請稍後重試。';
    d.prepare("UPDATE hobo_jobs SET status=?,lease_until=0,attempts=?,next_attempt=?,error=? WHERE id=? AND lease_token=?").run(attempts>=3?'FAILED':'QUEUED',attempts,now+Math.min(3600000,60000*2**attempts),error,job.id,job.lease_token);
    return {id:job.id,status:attempts>=3?'FAILED':'QUEUED'};
  }
}

export const HOBO_COLUMNS=['logger_sn','sensor_sn','timestamp','data_type','data_type_id','value','unit','sensor_measurement_type'];
export function queryHobo(d,{serial,start,end,after=0,limit=200}){
  ensureHoboSchema(d);serial=hoboSerial(serial);({start,end}=hoboRange(start,end));
  if(!Number.isSafeInteger(after)||after<0)throw new HoboError(400,'分頁參數不正確。');
  limit=Math.min(Math.max(limit,1),1000);
  const rows=d.prepare(`SELECT rowid AS cursor,* FROM hobo_observations WHERE logger_sn=? AND timestamp>=? AND timestamp<=? AND rowid>? ORDER BY rowid LIMIT ?`).all(serial,start,end,after,limit);
  return {rows,next:rows.length===limit?rows.at(-1).cursor:null};
}
export function hoboCsvStream(d,range){
  ensureHoboSchema(d);const {start,end}=hoboRange(range.start,range.end),serial=hoboSerial(range.serial);
  const iterator=d.prepare(`SELECT * FROM hobo_observations WHERE logger_sn=? AND timestamp>=? AND timestamp<=? ORDER BY timestamp,sensor_sn,data_type_id`).iterate(serial,start,end);
  const encoder=new TextEncoder();let header=true;
  const cell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  return new ReadableStream({pull(controller){
    if(header){controller.enqueue(encoder.encode('\uFEFF'+HOBO_COLUMNS.join(',')+'\r\n'));header=false;return;}
    let chunk='';for(let n=0;n<200;n++){
      const item=iterator.next();if(item.done){if(chunk)controller.enqueue(encoder.encode(chunk));controller.close();return;}
      chunk+=HOBO_COLUMNS.map(key=>typeof item.value[key]==='number'?String(item.value[key]):cell(item.value[key])).join(',')+'\r\n';
    }controller.enqueue(encoder.encode(chunk));
  },cancel(){iterator.return?.();}});
}
