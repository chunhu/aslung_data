import {randomUUID,createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {mkdir,rename,unlink,stat,access} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {storageConfiguration,fileDigest,uploadResultFile,getResultObject} from './s3-storage.mjs';

export function processingRoot(){return resolve(process.env.CALIBRATION_RESULT_DIR||join(dirname(resolve(process.env.DATABASE_PATH||'data/aslung.sqlite')),'calibration-results'));}
export function resultPath(root,id){if(!/^[0-9a-f-]{36}$/.test(id))throw new Error('工作編號不正確。');return join(resolve(root),id+'.jsonl.gz');}
export function ensureProcessingStorageSchema(d){
  const own=!d.isTransaction;if(own)d.exec('BEGIN IMMEDIATE');
  try{
    const columns=new Set(d.prepare('PRAGMA table_info(processing_jobs)').all().map(c=>c.name));
    for(const name of ['result_bucket','result_region','result_key','result_sha256'])if(!columns.has(name))d.exec(`ALTER TABLE processing_jobs ADD COLUMN ${name} TEXT`);
    if(!columns.has('result_bytes'))d.exec('ALTER TABLE processing_jobs ADD COLUMN result_bytes INTEGER');
    d.exec(`CREATE TABLE IF NOT EXISTS processing_uploads(
      job_id TEXT PRIMARY KEY REFERENCES processing_jobs(id),bucket TEXT NOT NULL,region TEXT NOT NULL,object_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',attempts INTEGER NOT NULL DEFAULT 0,
      retry_at INTEGER NOT NULL DEFAULT 0,owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',uploaded_at TEXT);
      CREATE INDEX IF NOT EXISTS processing_upload_queue ON processing_uploads(status,retry_at);`);
    if(own)d.exec('COMMIT');
  }catch(e){if(own)d.exec('ROLLBACK');throw e;}
}
export function queueProcessingUpload(d,job,digest,configuration=storageConfiguration()){
  if(configuration.mode!=='s3')return;
  const day=new Date(Date.parse(job.start)+8*3600000).toISOString().slice(0,10).replaceAll('-','/');
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(job.device)||!/^[a-f0-9]{64}$/.test(digest.sha256))throw new Error('成果資訊不正確。');
  const key=`processed/${job.device}/${day}/${job.id}/${digest.sha256}.jsonl.gz`;
  d.prepare(`INSERT INTO processing_uploads(job_id,bucket,region,object_key,sha256,bytes) VALUES(?,?,?,?,?,?)`)
    .run(job.id,configuration.bucket,configuration.region,key,digest.sha256,digest.bytes);
}
export async function uploadNextProcessingResult(d,{root=processingRoot(),upload=uploadResultFile,now=Date.now()}={}){
  if(storageConfiguration().mode!=='s3')return null;
  const lease=30*60000,owner=randomUUID();
  const task=d.prepare(`UPDATE processing_uploads SET status='UPLOADING',owner=?,lease_until=?,attempts=attempts+1
    WHERE job_id=(SELECT u.job_id FROM processing_uploads u JOIN processing_jobs j ON j.id=u.job_id
      WHERE j.status='COMPLETED' AND u.status<>'STORED' AND u.retry_at<=? AND u.lease_until<=? ORDER BY u.retry_at,u.job_id LIMIT 1) RETURNING *`)
    .get(owner,now+lease,now,now);
  if(!task)return null;
  const heartbeat=()=>{
    if(!d.prepare("UPDATE processing_uploads SET lease_until=? WHERE job_id=? AND owner=? AND status='UPLOADING' AND lease_until>?")
      .run(Date.now()+lease,task.job_id,owner,Date.now()).changes)throw new Error('S3 上傳租約已失效。');
  };
  const timer=setInterval(()=>{try{heartbeat();}catch{}},30000);timer.unref();
  try{
    const path=resultPath(root,task.job_id),digest=await fileDigest(path);
    if(digest.sha256!==task.sha256||digest.bytes!==task.bytes)throw new Error('本機成果檢查碼不符。');
    heartbeat();await upload({path,bucket:task.bucket,region:task.region,key:task.object_key,sha256:task.sha256,bytes:task.bytes});
    d.exec('BEGIN IMMEDIATE');try{
      heartbeat();
      d.prepare('UPDATE processing_jobs SET result_bucket=?,result_region=?,result_key=? WHERE id=?').run(task.bucket,task.region,task.object_key,task.job_id);
      d.prepare("UPDATE processing_uploads SET status='STORED',owner=NULL,lease_until=0,last_error='',uploaded_at=? WHERE job_id=? AND owner=?").run(new Date().toISOString(),task.job_id,owner);
      d.exec('COMMIT');
    }catch(e){d.exec('ROLLBACK');throw e;}
    return {jobId:task.job_id,status:'STORED'};
  }catch(e){
    const retry=Date.now()+Math.min(3600000,30000*2**Math.min(task.attempts-1,7));
    const reason=String(e.name||'Error')+(e.$metadata?.httpStatusCode?` HTTP ${e.$metadata.httpStatusCode}`:'')+(e.name==='Error'?': '+String(e.message).slice(0,300):'');
    d.prepare("UPDATE processing_uploads SET status='RETRY',owner=NULL,lease_until=0,retry_at=?,last_error=? WHERE job_id=? AND owner=?").run(retry,reason,task.job_id,owner);
    return {jobId:task.job_id,status:'RETRY',error:reason};
  }finally{clearInterval(timer);}
}
export async function processingResultFile(job,root=processingRoot(),getObject=getResultObject){
  const target=resultPath(root,job.id);
  const checkDeleted=async()=>{
    try{await access(target+'.deleted');}catch(e){if(e.code==='ENOENT')return;throw e;}
    throw Object.assign(new Error('校正成果正在清除或已清除，請重新查詢。'),{status:410});
  };
  await checkDeleted();
  try{await stat(target);return target;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!job.result_bucket||!job.result_region||!job.result_key||!/^[a-f0-9]{64}$/.test(job.result_sha256||'')||!Number.isSafeInteger(job.result_bytes)||job.result_bytes<0)
    throw Object.assign(new Error('校正成果檔不存在，且尚無已驗證的 S3 副本。'),{status:409});
  await mkdir(root,{recursive:true,mode:0o700});
  const temporary=target+'.'+randomUUID()+'.download';let body;
  try{
    const result=await getObject(job);body=result.Body;
    if(!body||result.ContentLength!==job.result_bytes)throw new Error('S3 成果大小不符。');
    const hash=createHash('sha256');let bytes=0;
    const verify=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>job.result_bytes){done(new Error('S3 成果超過預期大小。'));return;}hash.update(chunk);done(null,chunk);}});
    await pipeline(body,verify,createWriteStream(temporary,{flags:'wx',mode:0o600}));
    if(bytes!==job.result_bytes||hash.digest('hex')!==job.result_sha256)throw new Error('S3 成果檢查碼不符。');
    await checkDeleted();await rename(temporary,target);
    try{await checkDeleted();}catch(e){await unlink(target).catch(()=>{});throw e;}return target;
  }catch(e){
    body?.destroy?.();await unlink(temporary).catch(()=>{});
    if(e.status===410)throw e;
    throw Object.assign(new Error('無法讀取並驗證 S3 校正成果，請稍後重試。'),{status:503,cause:e});
  }
}
