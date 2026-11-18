import {randomUUID} from 'node:crypto';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const uuid=/^[0-9a-f-]{36}$/;
const stamp=()=>new Date().toISOString();
function event(d,id,action,actor){d.prepare('INSERT INTO processing_cleanup_batch_events(plan_id,action,actor,created_at) VALUES(?,?,?,?)').run(id,action,actor,stamp());}
export function previewBatchedCleanup(d,{filters={},actor},{now=Date.now()}={},s){
 const {where,values}=s.conditions(filters),id=randomUUID(),created=new Date(now).toISOString(),expires=now+15*60000;
 const items=[],excluded=[],devices=new Set();let total=0,excludedCount=0,first=null,last=null;
 d.exec('BEGIN IMMEDIATE');try{
  d.prepare("DELETE FROM processing_cleanup_batch_items WHERE plan_id IN (SELECT b.plan_id FROM processing_cleanup_batches b LEFT JOIN processing_cleanup_plans p ON p.id=b.plan_id WHERE b.state='PREVIEW' AND (p.id IS NULL OR p.expires_at<?))").run(now);
  d.prepare("DELETE FROM processing_cleanup_batches WHERE state='PREVIEW' AND (NOT EXISTS(SELECT 1 FROM processing_cleanup_plans p WHERE p.id=plan_id) OR plan_id IN (SELECT id FROM processing_cleanup_plans WHERE confirmed_at IS NULL AND expires_at<?))").run(now);
  d.prepare('DELETE FROM processing_cleanup_plans WHERE confirmed_at IS NULL AND expires_at<?').run(now);
  for(const row of d.prepare('SELECT id FROM processing_jobs'+where+' ORDER BY created_at DESC,id DESC').iterate(...values)){
   const value=s.snapshot(d,row.id);
   if(!s.eligible(value)){excludedCount++;if(excluded.length<50)excluded.push({id:row.id,reason:'處理中、上傳中、歷史批次使用中或已被其他清除批次保留。'});continue;}
   // Validate exact S3 prefixes now; remote object versions are inventoried by
   // the worker per batch, instead of making unbounded cloud calls in HTTP.
   const scopes=s.remoteScopes(value),item={id:row.id,device:value.job.device,start:value.job.start,end:value.job.end,localCount:null,remoteCount:null,scopes};
   d.prepare('INSERT INTO processing_cleanup_batch_items(plan_id,ordinal,job_id,snapshot,fingerprint) VALUES(?,?,?,?,?)').run(id,total,row.id,JSON.stringify(value),s.fingerprint(value));
   if(items.length<50)items.push(item);devices.add(item.device);first=first===null||item.start<first?item.start:first;last=last===null||item.end>last?item.end:last;total++;
  }
  if(!total)fail(409,'沒有可清除的工作；可能正在處理、上傳、被歷史或其他清除批次保留。');
  const totals={devices:devices.size,first,last,jobs:total,excluded:excludedCount,batches:Math.ceil(total/500),localFiles:null,localBytes:null,s3Versions:null,s3Bytes:null};
  const payload={batched:true,filters,items,excluded,totals,inventoryDeferred:true,previewLimit:50};
  d.prepare('INSERT INTO processing_cleanup_plans(id,actor,created_at,expires_at,payload) VALUES(?,?,?,?,?)').run(id,actor,created,expires,JSON.stringify(payload));
  d.prepare('INSERT INTO processing_cleanup_batches(plan_id,total,created_at,updated_at) VALUES(?,?,?,?)').run(id,total,created,created);
  d.exec('COMMIT');return {id,expires_at:expires,...payload};
 }catch(e){d.exec('ROLLBACK');throw e;}
}
export async function confirmBatchedCleanup(d,{id,actor,confirmation,pauseSchedules},{saveBackup,now=Date.now()}={},s){
 if(!uuid.test(id||'')||confirmation!=='DELETE'||typeof pauseSchedules!=='boolean')fail(400,'請確認清除範圍並輸入 DELETE。');
 const plan=d.prepare('SELECT * FROM processing_cleanup_plans WHERE id=? AND actor=?').get(id,actor);
 if(!plan)fail(404,'找不到清除預覽。');
 if(plan.confirmed_at)return {ok:true,plan_id:id,reused:true};
 if(plan.expires_at<now)fail(409,'預覽已過期，請重新預覽。');
 const owner=randomUUID(),claimed=d.prepare("UPDATE processing_cleanup_batches SET owner=?,lease_until=? WHERE plan_id=? AND state='PREVIEW' AND lease_until<=?").run(owner,Date.now()+600000,id,Date.now());
 if(!claimed.changes)fail(409,'此批次正在確認或建立備份，請稍候重新整理。');
 try{
 const path=await saveBackup(d,id),payload=JSON.parse(plan.payload);
 d.exec('BEGIN IMMEDIATE');try{
  const live=d.prepare('SELECT * FROM processing_cleanup_plans WHERE id=?').get(id);
  if(live.confirmed_at){d.exec('COMMIT');return {ok:true,plan_id:id,reused:true};}
  const lock=d.prepare('SELECT owner,lease_until FROM processing_cleanup_batches WHERE plan_id=?').get(id);if(!lock||lock.owner!==owner||lock.lease_until<=Date.now())fail(409,'確認租約已過期，請重新預覽。');
  if(live.expires_at<Date.now())fail(409,'預覽已過期，請重新預覽。');
  const devices=new Set();
  for(const item of d.prepare('SELECT * FROM processing_cleanup_batch_items WHERE plan_id=? ORDER BY ordinal').iterate(id)){
   const value=s.snapshot(d,item.job_id);
   if(!s.eligible(value)||s.fingerprint(value)!==item.fingerprint)fail(409,'工作狀態或清除保留範圍已改變，請重新預覽。');
   devices.add(value.job.device);
  }
  if(pauseSchedules&&payload.filters.kind!=='raw'){
   if(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='processing_global'").get())d.prepare('UPDATE processing_global SET enabled=0,revision=revision+1,updated_by=?,updated_at=?').run(actor,stamp());
   for(const device of devices)d.prepare('UPDATE processing_schedules SET enabled=0,updated_by=? WHERE device=?').run(actor,device);
  }
  // A partial unique index makes two simultaneous confirmations of overlapping
  // plans atomic: one wins, the other must preview again.
  d.prepare("UPDATE processing_cleanup_batch_items SET state='WAITING' WHERE plan_id=?").run(id);
  d.prepare("UPDATE processing_cleanup_batches SET state='RUNNING',updated_at=? WHERE plan_id=? AND state='PREVIEW'").run(stamp(),id);
  d.prepare('UPDATE processing_cleanup_plans SET confirmed_at=?,backup_path=?,payload=? WHERE id=?').run(stamp(),path,JSON.stringify({...payload,pauseSchedules}),id);
  event(d,id,'confirm',actor);d.exec('COMMIT');return {ok:true,plan_id:id,jobs:payload.totals.jobs,batches:payload.totals.batches};
 }catch(e){d.exec('ROLLBACK');if(String(e.message).includes('UNIQUE'))fail(409,'部分工作已被另一個清除批次保留，請重新預覽。');throw e;}
 }finally{d.prepare('UPDATE processing_cleanup_batches SET owner=NULL,lease_until=0 WHERE plan_id=? AND owner=?').run(id,owner);}
}
export function settleCleanupBatch(d,id){
 const batch=d.prepare('SELECT * FROM processing_cleanup_batches WHERE plan_id=?').get(id);if(!batch||['PREVIEW','DONE','CANCELLED'].includes(batch.state))return;
 const active=d.prepare("SELECT COUNT(*) n FROM processing_cleanup_batch_items WHERE plan_id=? AND state='ACTIVE'").get(id).n;
 if(!active&&(batch.cancel_requested||batch.next_ordinal>=batch.total)){
  const state=batch.cancel_requested?'CANCELLED':'DONE';
  d.prepare('UPDATE processing_cleanup_batches SET state=?,finished_at=?,updated_at=? WHERE plan_id=?').run(state,stamp(),stamp(),id);event(d,id,state.toLowerCase(),'worker');
 }
}
export function controlCleanupBatch(d,{id,operation},actor){
 if(!uuid.test(id||'')||!['pause','resume','cancel','retry'].includes(operation))fail(400,'批次清除操作不正確。');
 d.exec('BEGIN IMMEDIATE');try{
  const batch=d.prepare('SELECT * FROM processing_cleanup_batches WHERE plan_id=?').get(id);if(!batch)fail(404,'找不到清除批次。');
  const allowed={pause:['RUNNING'],resume:['PAUSED'],cancel:['RUNNING','PAUSED','FAILED'],retry:['FAILED']};
  if(!allowed[operation].includes(batch.state))fail(409,'清除批次狀態已變更，請重新整理。');
  let state={pause:'PAUSED',resume:'RUNNING',retry:batch.cancel_requested?'CANCELLING':'RUNNING',cancel:'CANCELLING'}[operation];
  if(operation==='cancel'){
   d.prepare("UPDATE processing_cleanup_batch_items SET state='CANCELLED' WHERE plan_id=? AND state='WAITING'").run(id);
   // A task that has ever started can have removed remote versions already.
   // Finish such tasks safely; only never-started tasks can restore job status.
   for(const item of d.prepare(`SELECT i.*,t.id task_id FROM processing_cleanup_batch_items i JOIN processing_cleanup_tasks t ON t.job_id=i.job_id AND t.plan_id=i.plan_id WHERE i.plan_id=? AND i.state='ACTIVE' AND t.state='QUEUED' AND t.attempts=0`).all(id)){
    const original=JSON.parse(item.snapshot).job;
    d.prepare("UPDATE processing_jobs SET status=? WHERE id=? AND status='DELETING'").run(original.status,item.job_id);
    d.prepare("UPDATE processing_cleanup_tasks SET state='CANCELLED',finished_at=? WHERE id=?").run(stamp(),item.task_id);
    d.prepare("UPDATE processing_cleanup_batch_items SET state='CANCELLED' WHERE plan_id=? AND ordinal=?").run(id,item.ordinal);
   }
   if(d.prepare("SELECT 1 FROM processing_cleanup_tasks WHERE plan_id=? AND state='RETRY'").get(id))state='FAILED';
  }
  if(operation==='retry')d.prepare("UPDATE processing_cleanup_tasks SET state='QUEUED',retry_at=0,last_error='' WHERE plan_id=? AND state='RETRY'").run(id);
  d.prepare('UPDATE processing_cleanup_batches SET state=?,cancel_requested=?,error=?,updated_at=? WHERE plan_id=?').run(state,operation==='cancel'?1:batch.cancel_requested,state==='FAILED'?'部分已開始的清除失敗，請重試以安全完成；其餘工作已取消。':'',stamp(),id);
  event(d,id,operation,actor);settleCleanupBatch(d,id);d.exec('COMMIT');return {ok:true,id,state:d.prepare('SELECT state FROM processing_cleanup_batches WHERE plan_id=?').get(id).state};
 }catch(e){d.exec('ROLLBACK');throw e;}
}
export function cleanupBatchStatus(d){
 return d.prepare(`SELECT b.*,p.actor,p.backup_path,json_extract(p.payload,'$.filters') filters,
 (SELECT COUNT(*) FROM processing_cleanup_batch_items i WHERE i.plan_id=b.plan_id AND i.state='DONE') done,
 (SELECT COUNT(*) FROM processing_cleanup_batch_items i WHERE i.plan_id=b.plan_id AND i.state='CANCELLED') cancelled,
 (SELECT COUNT(*) FROM processing_cleanup_batch_items i WHERE i.plan_id=b.plan_id AND i.state='WAITING') waiting,
 (SELECT COUNT(*) FROM processing_cleanup_tasks t WHERE t.plan_id=b.plan_id AND t.state='RUNNING') running,
 (SELECT COUNT(*) FROM processing_cleanup_tasks t WHERE t.plan_id=b.plan_id AND t.state='RETRY') failed
 FROM processing_cleanup_batches b JOIN processing_cleanup_plans p ON p.id=b.plan_id WHERE b.state<>'PREVIEW' ORDER BY b.created_at DESC,b.plan_id DESC LIMIT 30`).all().map(row=>({...row,filters:JSON.parse(row.filters),batches:Math.ceil(row.total/row.batch_size)}));
}
export async function advanceCleanupBatch(d,{root,inventory,now=Date.now()}={},s){
 const owner=randomUUID(),lease=30*60000;
 let id;
 d.exec('BEGIN IMMEDIATE');try{
  for(const row of d.prepare("SELECT plan_id FROM processing_cleanup_batches WHERE state IN ('RUNNING','CANCELLING')").all())settleCleanupBatch(d,row.plan_id);
  const batch=d.prepare(`UPDATE processing_cleanup_batches SET owner=?,lease_until=? WHERE plan_id=(SELECT b.plan_id FROM processing_cleanup_batches b WHERE b.state='RUNNING' AND b.lease_until<=? AND b.next_ordinal<b.total AND NOT EXISTS(SELECT 1 FROM processing_cleanup_batch_items i WHERE i.plan_id=b.plan_id AND i.state='ACTIVE') ORDER BY b.created_at,b.plan_id LIMIT 1) RETURNING *`).get(owner,now+lease,now);
  if(!batch){d.exec('COMMIT');return null;}id=batch.plan_id;d.exec('COMMIT');
  const items=d.prepare("SELECT * FROM processing_cleanup_batch_items WHERE plan_id=? AND state='WAITING' ORDER BY ordinal LIMIT ?").all(id,batch.batch_size),staged=[];
  const heartbeat=()=>{if(!d.prepare("UPDATE processing_cleanup_batches SET lease_until=? WHERE plan_id=? AND owner=? AND state='RUNNING'").run(Date.now()+lease,id,owner).changes)throw new Error('批次已暫停、取消或租約已變更。');};
  const timer=setInterval(()=>{try{heartbeat();}catch{}},30000);timer.unref();
  try{
   let next=0;
   const results=await Promise.allSettled(Array.from({length:Math.min(4,items.length)},async()=>{
    while(next<items.length){const item=items[next++],value=s.snapshot(d,item.job_id);
     heartbeat();if(!s.eligible(value,id)||s.fingerprint(value)!==item.fingerprint)throw new Error('尚未清除的工作已變更，停止批次；請取消剩餘工作後重新預覽。');
     const local=await s.localFiles(root,item.job_id),scopes=s.remoteScopes(value);let remoteCount=0,remoteBytes=0;
     for(const scope of scopes){const objects=await inventory(scope);remoteCount+=objects.length;remoteBytes+=objects.reduce((n,o)=>n+o.bytes,0);heartbeat();}
     staged.push({id:item.job_id,device:value.job.device,start:value.job.start,end:value.job.end,fingerprint:item.fingerprint,localCount:local.length,localBytes:local.reduce((n,f)=>n+f.bytes,0),remoteCount,remoteBytes,scopes});
    }
   }));
   const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
   d.exec('BEGIN IMMEDIATE');try{
    const live=d.prepare('SELECT * FROM processing_cleanup_batches WHERE plan_id=?').get(id);
    if(live.state!=='RUNNING'||live.owner!==owner||live.lease_until<=Date.now())throw new Error('批次狀態已改變，停止排入下一批。');
    for(const item of staged){const value=s.snapshot(d,item.id);if(!s.eligible(value,id)||s.fingerprint(value)!==item.fingerprint)throw new Error('工作狀態已改變，請重新確認清除範圍。');}
    for(const item of staged){
     d.prepare("UPDATE processing_jobs SET status='DELETING',owner=NULL,lease_until=0 WHERE id=?").run(item.id);
     d.prepare("DELETE FROM processing_cleanup_tasks WHERE job_id=? AND state='CANCELLED'").run(item.id);
     d.prepare('INSERT INTO processing_cleanup_tasks(id,plan_id,job_id,device,start,end,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),id,item.id,item.device,item.start,item.end,JSON.stringify(item),stamp());
     d.prepare("UPDATE processing_cleanup_batch_items SET state='ACTIVE' WHERE plan_id=? AND job_id=?").run(id,item.id);
    }
    d.prepare('UPDATE processing_cleanup_batches SET next_ordinal=next_ordinal+?,current_batch=current_batch+1,updated_at=? WHERE plan_id=?').run(staged.length,stamp(),id);event(d,id,'batch-start','worker');d.exec('COMMIT');return {id,queued:staged.length};
   }catch(e){d.exec('ROLLBACK');throw e;}
  }finally{clearInterval(timer);}
 }catch(e){
  if(d.isTransaction)d.exec('ROLLBACK');
  if(id)d.prepare("UPDATE processing_cleanup_batches SET state='FAILED',error=?,updated_at=? WHERE plan_id=? AND owner=? AND state='RUNNING'").run(String(e.message).slice(0,1000),stamp(),id,owner);
  return {id,error:e.message};
 }finally{if(id)d.prepare('UPDATE processing_cleanup_batches SET owner=NULL,lease_until=0 WHERE plan_id=? AND owner=?').run(id,owner);}
}
