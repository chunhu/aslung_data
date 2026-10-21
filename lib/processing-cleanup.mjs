import {randomUUID,createHash} from 'node:crypto';
import {backup} from 'node:sqlite';
import {mkdir,readdir,lstat,unlink,writeFile,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {ensureProcessingSchema} from './processing-jobs.mjs';
import {processingRoot,resultPath} from './processing-storage.mjs';
import {cleanupObjectVersions,purgeCleanupScope,validateCleanupScope} from './processing-cleanup-s3.mjs';

const error=(status,message)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function ensureCleanupSchema(d){
  ensureProcessingSchema(d);
  d.exec(`CREATE TABLE IF NOT EXISTS processing_cleanup_plans(id TEXT PRIMARY KEY,actor TEXT NOT NULL,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,payload TEXT NOT NULL,confirmed_at TEXT,backup_path TEXT);
    CREATE TABLE IF NOT EXISTS processing_cleanup_tasks(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL,job_id TEXT NOT NULL UNIQUE,device TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,
      payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'QUEUED',attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,finished_at TEXT);
    CREATE INDEX IF NOT EXISTS processing_cleanup_queue ON processing_cleanup_tasks(state,retry_at);`);
}
function snapshot(d,id){
  const job=d.prepare('SELECT id,device,start,end,status,recipe,cache_key,result_bucket,result_region,result_key,result_sha256,result_bytes FROM processing_jobs WHERE id=?').get(id);
  if(!job)return null;
  const upload=d.prepare('SELECT bucket,region,object_key,status FROM processing_uploads WHERE job_id=?').get(id);
  return {job,upload:upload||null};
}
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function remoteScopes({job,upload}){
  const scopes=new Map(),day=new Date(Date.parse(job.start)+8*3600000).toISOString().slice(0,10).replaceAll('-','/');
  for(const ref of [job.result_key?{bucket:job.result_bucket,region:job.result_region,key:job.result_key}:null,upload?{bucket:upload.bucket,region:upload.region,key:upload.object_key}:null]){
    if(!ref)continue;
    const scope={bucket:ref.bucket,region:ref.region,prefix:`processed/${job.device}/${day}/${job.id}/`};validateCleanupScope(scope);
    if(!ref.key.startsWith(scope.prefix)||!/^[a-f0-9]{64}\.jsonl\.gz$/.test(ref.key.slice(scope.prefix.length)))throw error(409,'成果參照與工作不符，停止清除。');
    scopes.set(JSON.stringify(scope),scope);
  }
  return [...scopes.values()];
}
async function localFiles(root,id){
  resultPath(root,id);
  let names;try{names=await readdir(root);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const files=[];
  for(const name of names){
    if(name!==id+'.jsonl.gz'&&!(name.startsWith(id+'.jsonl.gz.')&&/^[0-9a-f-]{36}\.(tmp|download)$/.test(name.slice((id+'.jsonl.gz.').length))))continue;
    const info=await lstat(join(root,name));if(!info.isFile()||info.isSymbolicLink())throw error(409,'成果目錄有非一般檔案，停止清除。');
    files.push({name,bytes:info.size});
  }
  return files;
}
function eligible(value){return value&&!['RUNNING','DELETING'].includes(value.job.status)&&value.upload?.status!=='UPLOADING';}
function conditions(filters={}){
  if(!filters||typeof filters!=='object'||Array.isArray(filters)||Object.entries(filters).some(([key,value])=>!['device','from','to','status'].includes(key)||typeof value!=='string'))throw error(400,'篩選條件不正確。');
  const clauses=[],values=[];
  if(filters.device){if(!/^[A-Za-z0-9_-]{1,80}$/.test(filters.device))throw error(400,'設備 ID 不正確。');clauses.push('device=? COLLATE NOCASE');values.push(filters.device);}
  if(filters.status){if(!['QUEUED','RUNNING','COMPLETED','FAILED','DELETING'].includes(filters.status))throw error(400,'狀態不正確。');clauses.push('status=?');values.push(filters.status);}
  const day=value=>{const time=Date.parse(value+'T00:00:00+08:00');if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(time)||new Date(time+8*3600000).toISOString().slice(0,10)!==value)throw error(400,'日期不正確。');return time;};
  const from=filters.from?day(filters.from):null,to=filters.to?day(filters.to):null;
  if(from!==null&&to!==null&&from>to)throw error(400,'日期範圍不正確。');
  if(from!==null){clauses.push('end>?');values.push(new Date(from).toISOString());}
  if(to!==null){clauses.push('start<?');values.push(new Date(to+86400000).toISOString());}
  return {where:clauses.length?' WHERE '+clauses.join(' AND '):'',values};
}
export async function previewCleanup(d,{filters={},actor},{root=processingRoot(),inventory=cleanupObjectVersions,now=Date.now()}={}){
  ensureCleanupSchema(d);const {where,values}=conditions(filters);
  const matches=d.prepare('SELECT id FROM processing_jobs'+where+' ORDER BY created_at DESC,id DESC LIMIT 501').all(...values);
  if(matches.length>500)throw error(400,'每次最多清除 500 個工作，請縮小設備或日期篩選。');
  const items=[],excluded=[];
  // Bound cloud calls so previews do not exhaust memory or connection pools.
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,matches.length)},async()=>{
    while(next<matches.length){const {id}=matches[next++],value=snapshot(d,id);
      if(!eligible(value)){excluded.push({id,reason:'工作處理中、上傳中或已排入清除。'});continue;}
      const local=await localFiles(root,id),scopes=remoteScopes(value);let remoteCount=0,remoteBytes=0;
      for(const scope of scopes){const objects=await inventory(scope);remoteCount+=objects.length;remoteBytes+=objects.reduce((n,o)=>n+o.bytes,0);}
      items.push({id,device:value.job.device,start:value.job.start,end:value.job.end,fingerprint:fingerprint(value),localCount:local.length,localBytes:local.reduce((n,f)=>n+f.bytes,0),remoteCount,remoteBytes,scopes});
    }
  }));
  if(!items.length)throw error(409,'沒有可清除的工作；處理中或正在上傳的工作需等完成後再清除。');
  const id=randomUUID(),payload={filters,items,excluded},expires=now+15*60000;
  d.prepare('DELETE FROM processing_cleanup_plans WHERE confirmed_at IS NULL AND expires_at<?').run(now);
  d.prepare('INSERT INTO processing_cleanup_plans(id,actor,created_at,expires_at,payload) VALUES(?,?,?,?,?)').run(id,actor,new Date(now).toISOString(),expires,JSON.stringify(payload));
  return {id,expires_at:expires,...payload,totals:{jobs:items.length,excluded:excluded.length,localFiles:items.reduce((n,i)=>n+i.localCount,0),localBytes:items.reduce((n,i)=>n+i.localBytes,0),s3Versions:items.reduce((n,i)=>n+i.remoteCount,0),s3Bytes:items.reduce((n,i)=>n+i.remoteBytes,0)}};
}
async function databaseBackup(d,id){
  const directory=resolve(process.env.BACKUP_PATH||'backups');await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(directory,'before-cleanup-'+id+'.sqlite');await backup(d,path);await chmod(path,0o600);return path;
}
export async function confirmCleanup(d,{id,actor,confirmation,pauseSchedules},{saveBackup=databaseBackup,now=Date.now()}={}){
  ensureCleanupSchema(d);
  if(!uuid.test(id||'')||confirmation!=='DELETE'||typeof pauseSchedules!=='boolean')throw error(400,'請確認清除範圍並輸入 DELETE。');
  const plan=d.prepare('SELECT * FROM processing_cleanup_plans WHERE id=? AND actor=?').get(id,actor);
  if(!plan)throw error(404,'找不到清除預覽。');
  if(plan.confirmed_at)return {ok:true,plan_id:id,reused:true};
  if(plan.expires_at<now)throw error(409,'預覽已過期，請重新預覽。');
  const payload=JSON.parse(plan.payload),path=await saveBackup(d,id);
  d.exec('BEGIN IMMEDIATE');try{
    const live=d.prepare('SELECT * FROM processing_cleanup_plans WHERE id=?').get(id);
    if(live.confirmed_at){d.exec('COMMIT');return {ok:true,plan_id:id,reused:true};}
    if(live.expires_at<Date.now())throw error(409,'預覽已過期，請重新預覽。');
    for(const item of payload.items){const value=snapshot(d,item.id);if(!eligible(value)||fingerprint(value)!==item.fingerprint)throw error(409,'工作或上傳狀態已改變，請重新預覽。');}
    const time=new Date().toISOString();
    if(pauseSchedules){
      if(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='processing_global'").get())d.prepare('UPDATE processing_global SET enabled=0,revision=revision+1,updated_by=?,updated_at=?').run(actor,time);
      for(const device of new Set(payload.items.map(i=>i.device)))d.prepare('UPDATE processing_schedules SET enabled=0,updated_by=? WHERE device=?').run(actor,device);
    }
    for(const table of ['processing_global_seen','processing_global_days'])if(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
      for(const device of new Set(payload.items.map(i=>i.device)))d.prepare(`DELETE FROM ${table} WHERE device=?`).run(device);
    for(const item of payload.items){
      d.prepare("UPDATE processing_jobs SET status='DELETING',owner=NULL,lease_until=0 WHERE id=?").run(item.id);
      d.prepare('INSERT INTO processing_cleanup_tasks(id,plan_id,job_id,device,start,end,payload,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),id,item.id,item.device,item.start,item.end,JSON.stringify(item),time);
    }
    d.prepare('UPDATE processing_cleanup_plans SET confirmed_at=?,backup_path=?,payload=? WHERE id=?').run(time,path,JSON.stringify({...payload,pauseSchedules}),id);d.exec('COMMIT');return {ok:true,plan_id:id,jobs:payload.items.length};
  }catch(e){d.exec('ROLLBACK');throw e;}
}
export function retryCleanup(d,id){
  ensureCleanupSchema(d);if(!uuid.test(id||''))throw error(400,'清除編號不正確。');
  if(!d.prepare("UPDATE processing_cleanup_tasks SET state='QUEUED',retry_at=0,last_error='' WHERE id=? AND state='RETRY'").run(id).changes)throw error(409,'僅失敗的清除工作可重試。');
}
export function cleanupStatus(d){
  ensureCleanupSchema(d);return {counts:d.prepare('SELECT state,COUNT(*) AS count FROM processing_cleanup_tasks GROUP BY state').all(),tasks:d.prepare('SELECT id,plan_id,job_id,device,start,end,state,attempts,retry_at,last_error,created_at,finished_at FROM processing_cleanup_tasks ORDER BY created_at DESC,id DESC LIMIT 30').all()};
}
export async function runNextCleanup(d,{root=processingRoot(),purge=purgeCleanupScope,now=Date.now()}={}){
  ensureCleanupSchema(d);const owner=randomUUID(),lease=30*60000;
  const task=d.prepare(`UPDATE processing_cleanup_tasks SET state='RUNNING',owner=?,lease_until=?,attempts=attempts+1 WHERE id=(
    SELECT id FROM processing_cleanup_tasks WHERE (state IN ('QUEUED','RETRY') AND retry_at<=?) OR (state='RUNNING' AND lease_until<=?) ORDER BY created_at LIMIT 1) RETURNING *`).get(owner,now+lease,now,now);
  if(!task)return null;
  const heartbeat=()=>{if(!d.prepare("UPDATE processing_cleanup_tasks SET lease_until=? WHERE id=? AND owner=? AND state='RUNNING'").run(Date.now()+lease,task.id,owner).changes)throw new Error('清除租約已失效。');};
  const timer=setInterval(()=>{try{heartbeat();}catch{}},30000);timer.unref();
  try{
    const job=d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(task.job_id);if(job?.status!=='DELETING')throw new Error('工作不在清除狀態，停止操作。');
    await mkdir(root,{recursive:true,mode:0o700});
    // Keep a tiny tombstone to stop an in-flight S3 restore from recreating a file.
    const tombstone=resultPath(root,task.job_id)+'.deleted';
    try{await writeFile(tombstone,task.id,{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const info=await lstat(tombstone);if(!info.isFile()||info.isSymbolicLink())throw new Error('成果刪除標記不正確。');}
    const item=JSON.parse(task.payload);
    for(const scope of item.scopes){heartbeat();await purge(scope,heartbeat);}
    for(const file of await localFiles(root,task.job_id)){heartbeat();try{await unlink(join(root,file.name));}catch(e){if(e.code!=='ENOENT')throw e;}}
    d.exec('BEGIN IMMEDIATE');try{
      heartbeat();
      if(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='processing_query_snapshots'").get())d.prepare("DELETE FROM processing_query_snapshots WHERE EXISTS (SELECT 1 FROM json_each(processing_query_snapshots.pieces) WHERE json_extract(value,'$.id')=?)").run(task.job_id);
      d.prepare('DELETE FROM processing_uploads WHERE job_id=?').run(task.job_id);
      d.prepare("DELETE FROM processing_jobs WHERE id=? AND status='DELETING'").run(task.job_id);
      d.prepare("UPDATE processing_cleanup_tasks SET state='DONE',last_error='',finished_at=?,owner=NULL,lease_until=0 WHERE id=? AND owner=?").run(new Date().toISOString(),task.id,owner);
      d.exec('COMMIT');return {id:task.id,status:'DONE'};
    }catch(e){d.exec('ROLLBACK');throw e;}
  }catch(e){
    const reason=e.$metadata?.httpStatusCode===403||e.name==='AccessDenied'||String(e.message).includes('AccessDenied')?'S3 刪除權限不足（AccessDenied），請依部署說明補上清除權限後重試。':String(e.message||e.name).slice(0,1000);
    d.prepare("UPDATE processing_cleanup_tasks SET state='RETRY',last_error=?,retry_at=?,owner=NULL,lease_until=0 WHERE id=? AND owner=?").run(reason,Date.now()+Math.min(3600000,30000*2**Math.min(task.attempts-1,7)),task.id,owner);
    return {id:task.id,status:'RETRY',error:reason};
  }finally{clearInterval(timer);}
}
