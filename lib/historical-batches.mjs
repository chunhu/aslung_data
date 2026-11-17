import {randomUUID} from 'node:crypto';
import {ensureProcessingSchema,enqueueProcessing,retryProcessing} from './processing-jobs.mjs';
import {currentCalibrationRecords} from './calibration.mjs';
import {processingRecipe} from './measurement-processing.mjs';
import {queueProcessingUpload} from './processing-storage.mjs';
import {storageConfiguration} from './s3-storage.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const DAY=86400000,uuid=/^[a-f0-9-]{36}$/;
function day(value){const n=Date.parse(value+'T00:00:00+08:00');if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(n)||new Date(n+28800000).toISOString().slice(0,10)!==value)fail(400,'請選擇有效的臺灣日期。');return n;}
export function historicalMonths(from,to){
 const start=day(from),end=day(to)+DAY;
 if(end<=start||end-start>36600*DAY)fail(400,'封存日期需為有效正向區間，最長 100 年；更長期間請分批。');
 const months=[];
 for(let a=start;a<end;){const local=new Date(a+28800000),label=local.toISOString().slice(0,7);local.setUTCDate(1);local.setUTCMonth(local.getUTCMonth()+1);const b=Math.min(end,local.getTime()-28800000);months.push({label,start:new Date(a).toISOString(),end:new Date(b).toISOString(),days:(b-a)/DAY});a=b;}
 return months;
}
function event(d,id,action,actor){d.prepare('INSERT INTO historical_batch_events(batch_id,action,actor,created_at) VALUES(?,?,?,?)').run(id,action,actor,new Date().toISOString());}
export function createHistoricalBatch(d,p,actor,configuration=storageConfiguration()){
 if(configuration.mode!=='s3')fail(409,'請先啟用 S3 並設定原始封存權限。');
 ensureProcessingSchema(d);
 if(typeof actor!=='string'||!actor)fail(403,'缺少管理員身分。');
 if(!Array.isArray(p.devices)||!p.devices.length||p.devices.length>500||p.devices.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)))fail(400,'請選取 1 至 500 台有效設備。');
 if(!['raw','processed','both'].includes(p.kind))fail(400,'封存類型不正確。');
 if(p.refresh!==undefined&&typeof p.refresh!=='boolean')fail(400,'新版本設定不正確。');
 if(p.kind!=='raw')processingRecipe(p.upLimit===undefined?3:p.upLimit);
 const months=historicalMonths(p.from,p.to),devices=[...new Set(p.devices)].sort(),kinds=p.kind==='both'?['raw','processed']:[p.kind];
 const config={devices,kinds,from:p.from,to:p.to,upLimit:p.upLimit??3,refresh:!!p.refresh},serialized=JSON.stringify(config),key=p.requestKey||randomUUID();
 if(!uuid.test(key))fail(400,'請求識別碼不正確。');
 d.exec('BEGIN IMMEDIATE');try{
  const existing=d.prepare('SELECT * FROM historical_batches WHERE actor=? AND request_key=?').get(actor,key);
  if(existing){if(existing.configuration!==serialized)fail(409,'此請求已建立，請重新整理後再送出不同範圍。');d.exec('COMMIT');return {ok:true,id:existing.id,months:existing.total_months,total:existing.total_units,reused:true};}
  for(const device of devices)if(!d.prepare('SELECT id FROM devices WHERE id=?').get(device))fail(404,`找不到設備 ${device}。`);
  const id=randomUUID(),now=new Date().toISOString(),total=months.reduce((n,m)=>n+m.days*devices.length*kinds.length,0);
  d.prepare('INSERT INTO historical_batches(id,actor,request_key,configuration,total_months,total_units,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,actor,key,serialized,months.length,total,now,now);
  for(const [position,m] of months.entries())d.prepare('INSERT INTO historical_batch_months(batch_id,position,label,start,end,total) VALUES(?,?,?,?,?,?)').run(id,position,m.label,m.start,m.end,m.days*devices.length*kinds.length);
  event(d,id,'create',actor);d.exec('COMMIT');return {ok:true,id,months:months.length,total};
 }catch(e){d.exec('ROLLBACK');throw e;}
}
function monthProgress(d,id,position){
 const month=d.prepare('SELECT * FROM historical_batch_months WHERE batch_id=? AND position=?').get(id,position);if(!month)return null;
 if(month.status==='COMPLETED')return {...month,verified:month.total-month.skipped,queued:0,running:0,uploading:0,waiting_upload:0,failed:0,error:''};
 const stats=d.prepare(`SELECT COUNT(*) planned,
 SUM(CASE WHEN j.status='COMPLETED' AND u.status='STORED' THEN 1 ELSE 0 END) verified,
 SUM(CASE WHEN j.status='QUEUED' THEN 1 ELSE 0 END) queued,SUM(CASE WHEN j.status='RUNNING' THEN 1 ELSE 0 END) running,
 SUM(CASE WHEN u.status='UPLOADING' THEN 1 ELSE 0 END) uploading,
 SUM(CASE WHEN j.status='COMPLETED' AND COALESCE(u.status,'')<>'STORED' THEN 1 ELSE 0 END) waiting_upload,
 SUM(CASE WHEN j.id IS NULL OR j.status IN ('FAILED','DELETING','CANCELLED') OR u.status='RETRY' THEN 1 ELSE 0 END) failed,
 SUM(CASE WHEN j.status='COMPLETED' AND u.status='STORED' AND j.data_kind='raw' THEN j.rows_done ELSE 0 END) raw_rows,
 SUM(CASE WHEN j.status='COMPLETED' AND u.status='STORED' AND j.data_kind='processed' THEN j.rows_done ELSE 0 END) processed_rows,
 SUM(CASE WHEN j.status='COMPLETED' AND u.status='STORED' THEN u.bytes ELSE 0 END) bytes
 FROM historical_batch_jobs h LEFT JOIN processing_jobs j ON j.id=h.job_id LEFT JOIN processing_uploads u ON u.job_id=j.id WHERE h.batch_id=? AND h.month=?`).get(id,position);
 const problem=d.prepare(`SELECT j.error,u.last_error,j.status FROM historical_batch_jobs h LEFT JOIN processing_jobs j ON j.id=h.job_id LEFT JOIN processing_uploads u ON u.job_id=j.id
 WHERE h.batch_id=? AND h.month=? AND (j.id IS NULL OR j.status IN ('FAILED','DELETING','CANCELLED') OR u.status='RETRY') LIMIT 1`).get(id,position);
 return {...month,...Object.fromEntries(Object.entries(stats).map(([key,value])=>[key,Number(value||0)])),error:problem?(problem.error||problem.last_error||'工作已取消、刪除或遺失；請確認資料後再建立新批次。'):''};
}
export function historicalBatchStatus(d,{id,limit=30}={}){
 ensureProcessingSchema(d);if(id&&!uuid.test(id))fail(400,'批次識別碼不正確。');
 const batches=id?d.prepare('SELECT * FROM historical_batches WHERE id=?').all(id):d.prepare('SELECT * FROM historical_batches ORDER BY created_at DESC,id DESC LIMIT ?').all(Math.min(100,Math.max(1,limit)));
 return batches.map(batch=>{
  const months=d.prepare('SELECT position,label,start,end,total,generated,skipped,status,raw_rows,processed_rows,bytes FROM historical_batch_months WHERE batch_id=? ORDER BY position').all(batch.id);
  const current=monthProgress(d,batch.id,Math.min(batch.current_month,batch.total_months-1)),done=months.filter(m=>m.status==='COMPLETED'),prior=done.filter(m=>m.position!==current?.position);
  const sum=key=>prior.reduce((n,m)=>n+Number(m[key]||0),0)+Number(current?.[key]||0);
  return {...batch,configuration:JSON.parse(batch.configuration),months,current,completed_months:done.length,verified:prior.reduce((n,m)=>n+m.total-m.skipped,0)+Number(current?.verified||0),skipped:sum('skipped'),raw_rows:sum('raw_rows'),processed_rows:sum('processed_rows'),bytes:sum('bytes')};
 });
}
export function controlHistoricalBatch(d,{id,operation},actor){
 ensureProcessingSchema(d);if(!uuid.test(id||'')||!['pause','resume','retry','cancel'].includes(operation))fail(400,'封存操作不正確。');
 d.exec('BEGIN IMMEDIATE');try{
  const batch=d.prepare('SELECT * FROM historical_batches WHERE id=?').get(id);if(!batch)fail(404,'找不到歷史封存批次。');
  const allowed={pause:['QUEUED','RUNNING'],resume:['PAUSED'],retry:['FAILED'],cancel:['QUEUED','RUNNING','PAUSED','FAILED']};
  if(!allowed[operation].includes(batch.status))fail(409,'批次狀態已改變，請重新整理。');
  if(operation==='retry'){
   for(const ref of d.prepare('SELECT job_id FROM historical_batch_jobs WHERE batch_id=? AND month=?').all(id,batch.current_month)){
    const job=d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(ref.job_id);if(!job||['DELETING','CANCELLED'].includes(job.status))fail(409,'部分工作已刪除或取消，請建立新的歷史封存批次。');
    if(job.status==='FAILED')retryProcessing(d,ref.job_id);
    d.prepare("UPDATE processing_uploads SET status='PENDING',retry_at=0,last_error='' WHERE job_id=? AND status='RETRY'").run(ref.job_id);
   }
  }
  if(operation==='cancel')d.prepare(`UPDATE processing_jobs SET status='CANCELLED',error='歷史封存批次已取消。' WHERE status='QUEUED' AND id IN(
   SELECT h.job_id FROM historical_batch_jobs h WHERE h.batch_id=? AND h.owned=1 AND NOT EXISTS(
    SELECT 1 FROM historical_batch_jobs other JOIN historical_batches b ON b.id=other.batch_id WHERE other.job_id=h.job_id AND other.batch_id<>h.batch_id AND b.status IN ('QUEUED','RUNNING','PAUSED','FAILED')))` ).run(id);
  const status={pause:'PAUSED',resume:'RUNNING',retry:'RUNNING',cancel:'CANCELLED'}[operation],now=new Date().toISOString();
  d.prepare('UPDATE historical_batches SET status=?,error=?,updated_at=?,finished_at=? WHERE id=?').run(status,'',now,operation==='cancel'?now:null,id);event(d,id,operation,actor);d.exec('COMMIT');return {ok:true,id,status};
 }catch(e){d.exec('ROLLBACK');throw e;}
}
export function advanceHistoricalBatch(d,{configuration=storageConfiguration(),window=100}={}){
 ensureProcessingSchema(d);if(!Number.isInteger(window)||window<1||window>5000)fail(400,'內部分批上限需為 1 至 5000。');
 let batchId=null;
 d.exec('BEGIN IMMEDIATE');try{
  d.prepare(`UPDATE processing_jobs SET status='CANCELLED',owner=NULL,lease_until=0,error='歷史批次已取消，工作租約已結束。' WHERE status='RUNNING' AND lease_until<=? AND EXISTS(
   SELECT 1 FROM historical_batch_jobs h JOIN historical_batches b ON b.id=h.batch_id WHERE h.job_id=processing_jobs.id AND h.owned=1 AND b.status='CANCELLED') AND NOT EXISTS(
   SELECT 1 FROM historical_batch_jobs h JOIN historical_batches b ON b.id=h.batch_id WHERE h.job_id=processing_jobs.id AND b.status IN ('QUEUED','RUNNING','PAUSED','FAILED'))`).run(Date.now());
  d.prepare(`UPDATE processing_uploads SET status='CANCELLED',owner=NULL,lease_until=0,last_error='歷史批次已取消，上傳租約已結束。' WHERE status='UPLOADING' AND lease_until<=? AND EXISTS(
   SELECT 1 FROM historical_batch_jobs h JOIN historical_batches b ON b.id=h.batch_id WHERE h.job_id=processing_uploads.job_id AND h.owned=1 AND b.status='CANCELLED') AND NOT EXISTS(
   SELECT 1 FROM historical_batch_jobs h JOIN historical_batches b ON b.id=h.batch_id WHERE h.job_id=processing_uploads.job_id AND b.status IN ('QUEUED','RUNNING','PAUSED','FAILED'))`).run(Date.now());
  const batch=d.prepare("SELECT * FROM historical_batches WHERE status IN ('QUEUED','RUNNING') ORDER BY created_at,id LIMIT 1").get();
  if(!batch){d.exec('COMMIT');return null;}batchId=batch.id;
  if(configuration.mode!=='s3')fail(409,'S3 已停用，請恢復設定後重試此批次。');
  const config=JSON.parse(batch.configuration),now=new Date().toISOString();
  d.prepare("UPDATE historical_batches SET status='RUNNING',updated_at=? WHERE id=?").run(now,batch.id);
  let progress=monthProgress(d,batch.id,batch.current_month);
  if(progress.failed)fail(409,progress.error);
  if(progress.generated===progress.total&&progress.verified+progress.skipped===progress.total){
   d.prepare("UPDATE historical_batch_months SET status='COMPLETED',raw_rows=?,processed_rows=?,bytes=? WHERE batch_id=? AND position=?").run(progress.raw_rows,progress.processed_rows,progress.bytes,batch.id,batch.current_month);
   const next=batch.current_month+1;
   d.prepare('UPDATE historical_batches SET current_month=?,status=?,updated_at=?,finished_at=? WHERE id=?').run(next,next===batch.total_months?'COMPLETED':'RUNNING',now,next===batch.total_months?now:null,batch.id);
   event(d,batch.id,next===batch.total_months?'complete':'month-complete','worker');d.exec('COMMIT');return {id:batch.id,status:next===batch.total_months?'COMPLETED':'RUNNING'};
  }
  const pending=progress.generated-progress.skipped-progress.verified,allowance=Math.max(0,window-pending),take=Math.min(allowance,progress.total-progress.generated);
  const examples=JSON.parse(progress.skipped_examples),factorCache=new Map();let skipped=0;
  for(let ordinal=progress.generated;ordinal<progress.generated+take;ordinal++){
   const type=config.kinds[ordinal%config.kinds.length],unit=Math.floor(ordinal/config.kinds.length),device=config.devices[unit%config.devices.length],dayIndex=Math.floor(unit/config.devices.length);
   const start=new Date(Date.parse(progress.start)+dayIndex*DAY).toISOString(),end=new Date(Date.parse(start)+DAY).toISOString();
   if(!d.prepare('SELECT id FROM devices WHERE id=?').get(device))fail(409,`設備 ${device} 已移除；請確認名冊後重試。`);
   if(type==='processed'){
    if(!factorCache.has(device))factorCache.set(device,currentCalibrationRecords(d,device).filter(r=>!r.channel.startsWith('UNMAPPED:')&&r.channel!=='PM125'));
    if(!factorCache.get(device).some(r=>r.start<end&&(!r.end||r.end>start))){skipped++;if(examples.length<20)examples.push({device,day:start,reason:'NO_FACTOR'});continue;}
   }
   const countBefore=d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n;
   let id=enqueueProcessing(d,{device,start,end,dataKind:type,upLimit:config.upLimit,actor:batch.actor,refresh:config.refresh?'history:'+batch.id:''});
   if(d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(id).status==='CANCELLED')id=enqueueProcessing(d,{device,start,end,dataKind:type,upLimit:config.upLimit,actor:batch.actor,refresh:'history:'+batch.id});
   const job=d.prepare('SELECT * FROM processing_jobs WHERE id=?').get(id),owned=d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n>countBefore?1:0;
   d.prepare('INSERT INTO historical_batch_jobs VALUES(?,?,?,?,?)').run(batch.id,batch.current_month,ordinal,id,owned);
   if(job.status==='COMPLETED'&&!d.prepare('SELECT 1 FROM processing_uploads WHERE job_id=?').get(id)){
    if(!job.result_sha256||!Number.isSafeInteger(job.result_bytes))fail(409,'既有成果缺少檢查碼，請使用重新抓取建立新版本。');
    queueProcessingUpload(d,job,{sha256:job.result_sha256,bytes:job.result_bytes},configuration);
   }
  }
  d.prepare("UPDATE historical_batch_months SET generated=generated+?,skipped=skipped+?,skipped_examples=?,status='RUNNING' WHERE batch_id=? AND position=?").run(take,skipped,JSON.stringify(examples),batch.id,batch.current_month);
  const after=monthProgress(d,batch.id,batch.current_month);
  if(after.failed){d.prepare("UPDATE historical_batches SET status='FAILED',error=? WHERE id=?").run(after.error,batch.id);d.exec('COMMIT');return {id:batch.id,status:'FAILED',error:after.error};}
  d.exec('COMMIT');return {id:batch.id,status:'RUNNING',generated:take};
 }catch(e){d.exec('ROLLBACK');if(!batchId)throw e;d.prepare("UPDATE historical_batches SET status='FAILED',error=?,updated_at=? WHERE id=? AND status IN ('QUEUED','RUNNING')").run(String(e.message).slice(0,2000),new Date().toISOString(),batchId);return {id:batchId,status:'FAILED',error:e.message};}
}
