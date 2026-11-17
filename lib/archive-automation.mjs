import {randomUUID} from 'node:crypto';
import {ensureProcessingSchema,enqueueProcessing,retryProcessing} from './processing-jobs.mjs';
import {ensureGlobalProcessingSchema} from './global-processing.mjs';
import {currentCalibrationRecords} from './calibration.mjs';
import {storageConfiguration} from './s3-storage.mjs';
import {queueProcessingUpload} from './processing-storage.mjs';
const DAY=86400000;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function ensureArchiveAutomation(d){
 ensureGlobalProcessingSchema(d);
 d.exec(`CREATE TABLE IF NOT EXISTS archive_automation(id INTEGER PRIMARY KEY CHECK(id=1),monthly_enabled INTEGER NOT NULL DEFAULT 0,late_enabled INTEGER NOT NULL DEFAULT 0,month_day INTEGER NOT NULL DEFAULT 5,cursor TEXT,last_scan TEXT,last_error TEXT NOT NULL DEFAULT '',retry_at INTEGER NOT NULL DEFAULT 0,owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,updated_by TEXT,updated_at TEXT);
 INSERT OR IGNORE INTO archive_automation(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS archive_runs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,period TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS archive_units(run_id TEXT NOT NULL,device TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,up_limit REAL NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',raw_job TEXT,processed_job TEXT,skipped TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',PRIMARY KEY(run_id,device,start));
 CREATE INDEX IF NOT EXISTS archive_unit_queue ON archive_units(status,run_id);
 CREATE TABLE IF NOT EXISTS archive_suppressions(device TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,data_kind TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(device,start,end,data_kind));`);
}
export function archiveAutomationStatus(d){
 ensureArchiveAutomation(d);
 const settings=d.prepare('SELECT monthly_enabled,late_enabled,month_day,cursor,last_scan,last_error,updated_at FROM archive_automation WHERE id=1').get();
 const runs=d.prepare(`SELECT r.*,COUNT(u.device) total,SUM(CASE WHEN u.status='PENDING' THEN 1 ELSE 0 END) pending,SUM(CASE WHEN u.status='FAILED' OR j.status='FAILED' OR p.status='FAILED' OR a.status='RETRY' OR b.status='RETRY' THEN 1 ELSE 0 END) failed,
 SUM(CASE WHEN u.status='PLANNED' AND (u.raw_job IS NULL OR (j.status='COMPLETED' AND a.status='STORED')) AND (u.processed_job IS NULL OR (p.status='COMPLETED' AND b.status='STORED')) THEN 1 ELSE 0 END) verified
 FROM archive_runs r LEFT JOIN archive_units u ON u.run_id=r.id LEFT JOIN processing_jobs j ON j.id=u.raw_job LEFT JOIN processing_uploads a ON a.job_id=j.id LEFT JOIN processing_jobs p ON p.id=u.processed_job LEFT JOIN processing_uploads b ON b.job_id=p.id
 GROUP BY r.id ORDER BY r.created_at DESC,r.id DESC LIMIT 20`).all();
 const issues=d.prepare("SELECT run_id,device,start,end,error FROM archive_units WHERE status='FAILED' ORDER BY run_id DESC LIMIT 20").all();
 return {settings,runs,issues};
}
export function saveArchiveAutomation(d,p,actor){
 ensureArchiveAutomation(d);
 if(typeof p.monthlyEnabled!=='boolean'||typeof p.lateEnabled!=='boolean'||!Number.isInteger(p.monthDay)||p.monthDay<1||p.monthDay>28)fail(400,'請設定有效的月封存日期（1 至 28）及啟用狀態。');
 d.prepare("UPDATE archive_automation SET monthly_enabled=?,late_enabled=?,month_day=?,revision=revision+1,retry_at=0,last_error='',updated_by=?,updated_at=? WHERE id=1").run(+p.monthlyEnabled,+p.lateEnabled,p.monthDay,actor,new Date().toISOString());
}
export function retryArchiveAutomation(d){
 ensureArchiveAutomation(d);d.prepare("UPDATE archive_units SET status='PENDING',error='' WHERE status='FAILED'").run();
 d.prepare("UPDATE archive_automation SET retry_at=0,last_error='' WHERE id=1").run();
 // Retry processing/upload failures without recomputing already verified results.
 for(const row of d.prepare("SELECT DISTINCT j.id FROM processing_jobs j JOIN archive_units u ON j.id=u.raw_job OR j.id=u.processed_job WHERE j.status='FAILED'").all())retryProcessing(d,row.id);
 d.prepare("UPDATE processing_uploads SET status='PENDING',retry_at=0,last_error='' WHERE status='RETRY' AND job_id IN (SELECT raw_job FROM archive_units UNION SELECT processed_job FROM archive_units)").run();
}
function addRun(d,id,kind,period,units,now){
 if(!units.length)return;
 if(d.prepare('SELECT 1 FROM archive_runs WHERE id=?').get(id))return;
 d.prepare('INSERT INTO archive_runs VALUES(?,?,?,?)').run(id,kind,period,now);
 for(const unit of units)d.prepare('INSERT OR IGNORE INTO archive_units(run_id,device,start,end,up_limit) VALUES(?,?,?,?,?)').run(id,unit.device,unit.start,unit.end,unit.upLimit);
}
function dates(device,start,end,upLimit){const units=[];for(let a=start;a<end;a+=DAY)units.push({device,start:new Date(a).toISOString(),end:new Date(a+DAY).toISOString(),upLimit});return units;}
// One source day per worker round. A lease protects the external SELECT and final transaction.
export async function runArchiveAutomation(d,{observe,arrivals,configuration=storageConfiguration(),now=new Date()}={}){
 ensureArchiveAutomation(d);if(configuration.mode!=='s3')return null;
 const owner=randomUUID(),stamp=now.getTime();
 const settings=d.prepare('UPDATE archive_automation SET owner=?,lease_until=? WHERE id=1 AND lease_until<=? AND retry_at<=? RETURNING *').get(owner,Date.now()+600000,Date.now(),stamp);if(!settings)return null;
 const local=new Date(stamp+28800000),day=local.toISOString().slice(0,10),midnight=Date.parse(day+'T00:00:00+08:00');
 try{
  const global=d.prepare('SELECT * FROM processing_global WHERE id=1').get(),registered=d.prepare('SELECT id FROM devices ORDER BY id').all().map(r=>r.id),manual=new Map(d.prepare('SELECT * FROM processing_schedules WHERE enabled=1').all().map(r=>[r.device,r]));
  const limit=device=>manual.get(device)?.up_limit??global.up_limit;
  d.exec('BEGIN IMMEDIATE');try{
   if(local.getUTCHours()>=3){
    const daily=registered.filter(device=>global.enabled||manual.has(device));
    // Every day gets a separate request, but identical observed versions reuse the same jobs.
    addRun(d,'daily:'+day,'daily',day,daily.flatMap(device=>dates(device,midnight-3*DAY,midnight,limit(device))),now.toISOString());
    if(settings.monthly_enabled&&local.getUTCDate()>=settings.month_day){
     const end=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),1)-28800000).getTime(),start=Date.UTC(local.getUTCFullYear(),local.getUTCMonth()-1,1)-28800000;
     const month=new Date(start+28800000).toISOString().slice(0,7);
     addRun(d,'monthly:'+month,'monthly',month,registered.flatMap(device=>dates(device,start,end,limit(device))),now.toISOString());
    }
   }
   d.exec('COMMIT');
  }catch(e){d.exec('ROLLBACK');throw e;}
  // Poll only bounded new primary-key rows, regardless of the measurement date.
  if(settings.late_enabled&&(!settings.last_scan||stamp-Date.parse(settings.last_scan)>=60000)){
   const scan=await arrivals(settings.cursor),rows=scan.rows||[],units=new Map();
   let cursor=scan.baseline??settings.cursor;
   for(const row of rows){
    if(!/^\d+$/.test(String(row.id))||BigInt(row.id)<=BigInt(cursor||'0')||!/^\d{4}-\d{2}-\d{2}$/.test(row.day))throw new Error('補傳摘要格式不正確。');
    cursor=String(row.id);if(!registered.includes(row.device))continue;
    const start=Date.parse(row.day+'T00:00:00+08:00');if(!Number.isFinite(start)||start>=midnight)continue;
    // Recheck the changed day and adjacent archived periods: calibration uses context samples.
    const periods=[{start:new Date(start).toISOString(),end:new Date(start+DAY).toISOString()},...d.prepare(`SELECT start,end FROM processing_jobs WHERE device=? AND data_kind='processed' AND end<=? AND start<? ORDER BY end DESC LIMIT 1`).all(row.device,new Date(start).toISOString(),new Date(start).toISOString()),...d.prepare(`SELECT start,end FROM processing_jobs WHERE device=? AND data_kind='processed' AND start>=? AND end<=? ORDER BY start LIMIT 1`).all(row.device,new Date(start+DAY).toISOString(),new Date(midnight).toISOString())];
    for(const period of periods)units.set(row.device+period.start,{device:row.device,...period,upLimit:limit(row.device)});
   }
   d.exec('BEGIN IMMEDIATE');try{
    if(d.prepare('SELECT revision FROM archive_automation WHERE id=1').get().revision!==settings.revision)throw new Error('封存設定已變更，稍後重試。');
    if(units.size)addRun(d,'late:'+cursor,'late',day,[...units.values()],now.toISOString());
    d.prepare("UPDATE archive_automation SET cursor=?,last_scan=?,last_error='',retry_at=0 WHERE id=1 AND owner=?").run(cursor,now.toISOString(),owner);d.exec('COMMIT');
   }catch(e){d.exec('ROLLBACK');throw e;}
  }
  const unit=d.prepare(`SELECT u.*,r.kind FROM archive_units u JOIN archive_runs r ON r.id=u.run_id WHERE u.status='PENDING' ORDER BY CASE r.kind WHEN 'daily' THEN 0 WHEN 'late' THEN 1 ELSE 2 END,r.created_at,u.start,u.device LIMIT 1`).get();
  if(!unit)return {idle:true};
  try{
   const fingerprints=await observe(unit.device,unit.start,unit.end);
   if(!Number.isSafeInteger(fingerprints.count)||fingerprints.count<0)throw new Error('來源筆數不正確。');
   d.exec('BEGIN IMMEDIATE');try{
    const live=d.prepare('SELECT owner,revision,lease_until FROM archive_automation WHERE id=1').get();
    if(live.owner!==owner||live.revision!==settings.revision||live.lease_until<=Date.now())throw new Error('封存設定或工作租約已變更，停止本次發布。');
    const jobs={raw:null,processed:null},factors=currentCalibrationRecords(d,unit.device),hasFactors=factors.some(r=>!r.channel.startsWith('UNMAPPED:')&&r.channel!=='PM125'&&r.start<unit.end&&(!r.end||r.end>unit.start));
    let skipped='';
    for(const kind of ['raw','processed']){
     if(kind==='processed'&&!hasFactors){skipped+=(skipped?',':'')+'NO_FACTOR';continue;}
     if(!/^[a-f0-9]{64}$/.test(fingerprints[kind]))throw new Error('來源版本不正確。');
     // An intentional permanent cleanup must not be silently recreated by automation.
     if(d.prepare('SELECT 1 FROM archive_suppressions WHERE device=? AND start<? AND end>? AND data_kind=?').get(unit.device,unit.end,unit.start,kind)){skipped+=(skipped?',':'')+kind.toUpperCase()+'_SUPPRESSED';continue;}
     d.prepare(`INSERT INTO processing_observations VALUES(?,?,?,?,?) ON CONFLICT(device,start,end,data_kind) DO UPDATE SET fingerprint=excluded.fingerprint`).run(unit.device,unit.start,unit.end,kind,fingerprints[kind]);
     const id=enqueueProcessing(d,{device:unit.device,start:unit.start,end:unit.end,dataKind:kind,upLimit:unit.up_limit,actor:unit.kind+'-archive',sourceFingerprint:fingerprints[kind]});jobs[kind]=id;
     d.prepare('UPDATE historical_batch_jobs SET owned=0 WHERE job_id=?').run(id);
     const job=d.prepare('SELECT * FROM processing_jobs WHERE id=?').get(id);
     if(job.status==='COMPLETED'&&!d.prepare('SELECT 1 FROM processing_uploads WHERE job_id=?').get(id))queueProcessingUpload(d,job,{sha256:job.result_sha256,bytes:job.result_bytes},configuration);
    }
    d.prepare("UPDATE archive_units SET status='PLANNED',raw_job=?,processed_job=?,skipped=?,error='' WHERE run_id=? AND device=? AND start=?").run(jobs.raw,jobs.processed,skipped,unit.run_id,unit.device,unit.start);d.prepare("UPDATE archive_automation SET last_error='',retry_at=0 WHERE id=1 AND owner=?").run(owner);d.exec('COMMIT');return {device:unit.device,start:unit.start,kind:unit.kind,jobs};
   }catch(e){d.exec('ROLLBACK');throw e;}
  }catch(e){d.prepare("UPDATE archive_units SET status='FAILED',error=? WHERE run_id=? AND device=? AND start=? AND status='PENDING' AND EXISTS(SELECT 1 FROM archive_automation WHERE id=1 AND owner=?)").run(String(e.message).slice(0,2000),unit.run_id,unit.device,unit.start,owner);throw e;}
 }catch(e){d.prepare('UPDATE archive_automation SET last_error=?,retry_at=? WHERE id=1 AND owner=?').run(String(e.message).slice(0,2000),stamp+300000,owner);return {error:e.message};}
 finally{d.prepare('UPDATE archive_automation SET owner=NULL,lease_until=0 WHERE id=1 AND owner=?').run(owner);}
}
