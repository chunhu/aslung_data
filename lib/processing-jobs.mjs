import {createHash,randomUUID} from 'node:crypto';
import {mkdir,rename,unlink,open} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createGzip,createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {currentCalibrationRecords} from './calibration.mjs';
import {HALO,DEFAULT_UP_LIMIT,processMeasurements,processingRecipe} from './measurement-processing.mjs';
import {ensureProcessingStorageSchema,queueProcessingUpload,processingResultFile,processingRoot,resultPath} from './processing-storage.mjs';
import {fileDigest} from './s3-storage.mjs';
export {processingRoot,resultPath};

export function ensureProcessingSchema(d){
  d.exec(`CREATE TABLE IF NOT EXISTS processing_jobs(
    id TEXT PRIMARY KEY,device TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,
    recipe TEXT NOT NULL,factors TEXT NOT NULL,cache_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'QUEUED',rows_done INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '{}',error TEXT NOT NULL DEFAULT '',
    owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,
    actor TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT,context_start TEXT,context_end TEXT);
    CREATE INDEX IF NOT EXISTS processing_queue ON processing_jobs(status,created_at);
    CREATE TABLE IF NOT EXISTS processing_schedules(device TEXT PRIMARY KEY,up_limit REAL NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,last_day TEXT,updated_by TEXT NOT NULL,
    last_error TEXT NOT NULL DEFAULT '',last_attempt INTEGER NOT NULL DEFAULT 0);`);
  const columns=d.prepare('PRAGMA table_info(processing_schedules)').all();
  if(!columns.some(c=>c.name==='last_error'))d.exec("ALTER TABLE processing_schedules ADD COLUMN last_error TEXT NOT NULL DEFAULT ''");
  if(!columns.some(c=>c.name==='last_attempt'))d.exec('ALTER TABLE processing_schedules ADD COLUMN last_attempt INTEGER NOT NULL DEFAULT 0');
  const jobColumns=d.prepare('PRAGMA table_info(processing_jobs)').all();
  for(const column of ['context_start','context_end'])if(!jobColumns.some(c=>c.name===column))d.exec(`ALTER TABLE processing_jobs ADD COLUMN ${column} TEXT`);
  ensureProcessingStorageSchema(d);
}
export function enqueueProcessing(d,{device,start,end,upLimit=DEFAULT_UP_LIMIT,actor,refresh=''}){
  ensureProcessingSchema(d);const recipe=processingRecipe(upLimit);
  if(typeof device!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(device))throw new Error('設備 ID 不正確。');
  const a=Date.parse(start),b=Date.parse(end);
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b-a>86400000)throw new Error('每個工作區間需大於 0，且不得超過一天。');
  start=new Date(a).toISOString();end=new Date(b).toISOString();
  const factors=currentCalibrationRecords(d,device);
  if(!factors.some(r=>!r.channel.startsWith('UNMAPPED:')&&r.channel!=='PM125'&&r.start<end&&(!r.end||r.end>start)))throw new Error('此設備在指定區間沒有可使用的校正係數，請先同步來源。');
  const key=createHash('sha256').update(JSON.stringify({device,start,end,recipe,factors,refresh})).digest('hex');
  const existing=d.prepare('SELECT id FROM processing_jobs WHERE cache_key=?').get(key);if(existing)return existing.id;
  const id=randomUUID();d.prepare('INSERT INTO processing_jobs(id,device,start,end,recipe,factors,cache_key,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id,device,start,end,JSON.stringify(recipe),JSON.stringify(factors),key,actor,new Date().toISOString());return id;
}
export function retryProcessing(d,id){
  ensureProcessingSchema(d);
  const changed=d.prepare("UPDATE processing_jobs SET status='QUEUED',attempts=0,error='',rows_done=0 WHERE id=? AND status='FAILED'").run(id);
  if(!changed.changes)throw new Error('僅失敗的工作可以重試。');
}
export function saveProcessingSchedule(d,{device,upLimit=DEFAULT_UP_LIMIT,enabled,actor}){
  ensureProcessingSchema(d);processingRecipe(upLimit);
  if(typeof enabled!=='boolean')throw new Error('排程狀態不正確。');
  if(!d.prepare('SELECT id FROM devices WHERE id=?').get(device))throw new Error('找不到設備。');
  d.prepare(`INSERT INTO processing_schedules(device,up_limit,enabled,updated_by) VALUES(?,?,?,?)
    ON CONFLICT(device) DO UPDATE SET up_limit=excluded.up_limit,enabled=excluded.enabled,updated_by=excluded.updated_by,last_day=NULL,last_error='',last_attempt=0`).run(device,upLimit,+enabled,actor);
}
export function scheduleProcessing(d,now=new Date()){
  ensureProcessingSchema(d);
  const local=new Date(now.getTime()+8*3600000);if(local.getUTCHours()<3)return;
  const day=local.toISOString().slice(0,10);
  for(const schedule of d.prepare('SELECT * FROM processing_schedules WHERE enabled=1 AND (last_day IS NULL OR last_day<>?) AND last_attempt<=?').all(day,now.getTime()-300000)){
    // Rolling three completed Taiwan days also covers routine late arrivals. Historical backfill is explicit.
    try{
      d.prepare('UPDATE processing_schedules SET last_attempt=? WHERE device=?').run(now.getTime(),schedule.device);
      for(let back=1;back<=3;back++){
        const end=Date.parse(day+'T00:00:00+08:00')-(back-1)*86400000;
        enqueueProcessing(d,{device:schedule.device,start:new Date(end-86400000).toISOString(),end:new Date(end).toISOString(),upLimit:schedule.up_limit,actor:'scheduler',refresh:day});
      }
      d.prepare("UPDATE processing_schedules SET last_day=?,last_error='' WHERE device=?").run(day,schedule.device);
    }catch(e){
      // Do not suppress other devices or mark an incomplete schedule as finished.
      console.error('[Processing] 排程未建立',schedule.device,e.message);
      d.prepare('UPDATE processing_schedules SET last_error=? WHERE device=?').run(String(e.message).slice(0,2000),schedule.device);
    }
  }
}
export function claimProcessing(d,now=Date.now()){
  ensureProcessingSchema(d);
  d.prepare("UPDATE processing_jobs SET status='FAILED',error='工作多次中斷，請手動重試。' WHERE status='RUNNING' AND lease_until<=? AND attempts>=3").run(now);
  return d.prepare(`UPDATE processing_jobs SET status='RUNNING',owner=?,lease_until=?,attempts=attempts+1,rows_done=0,error=''
    WHERE id=(SELECT id FROM processing_jobs WHERE (status='QUEUED' OR (status='RUNNING' AND lease_until<=?)) AND attempts<3 ORDER BY created_at LIMIT 1) RETURNING *`)
    .get(randomUUID(),now+120000,now);
}
export async function* processedBlocks(input,job,heartbeat=()=>{}){
  const factors=JSON.parse(job.factors),recipe=JSON.parse(job.recipe);let pending=[],before=[];
  const block=take=>{
    const context=[...before,...pending.slice(0,take+HALO)],offset=before.length;
    const calculated=processMeasurements(context,factors,recipe).slice(offset,offset+take);
    calculated.forEach((r,i)=>{
      r._background_status=offset+i<HALO||context.length-offset-i-1<HALO?'INSUFFICIENT_CONTEXT':'COMPLETE';
    });
    before=[...before,...pending.slice(0,take)].slice(-HALO);pending=pending.slice(take);
    return calculated.filter(r=>r.timestamp>=job.start&&r.timestamp<job.end);
  };
  for await(const row of input){
    pending.push(row);
    if(pending.length>=2000+HALO){heartbeat();yield block(2000);}
  }
  if(pending.length){heartbeat();yield block(pending.length);}
}
export async function runProcessing(d,job,input,root=processingRoot()){
  await mkdir(root,{recursive:true,mode:0o700});
  const target=resultPath(root,job.id),temporary=target+'.'+job.owner+'.tmp';
  let count=0,contextStart=job.start,contextEnd=job.end;const summary={flags:{},incompleteContext:0};
  const heartbeat=()=>{
    const changed=d.prepare("UPDATE processing_jobs SET lease_until=?,rows_done=? WHERE id=? AND owner=? AND status='RUNNING' AND lease_until>?").run(Date.now()+120000,count,job.id,job.owner,Date.now());
    if(!changed.changes)throw new Error('工作租約已過期，停止發布結果。');
  };
  const timer=setInterval(()=>{try{heartbeat();}catch{/* Final publication checks the lease again. */}},30000);timer.unref();
  try{
    async function* trackedInput(){for await(const row of input){
      if(row.aslung_id!==job.device)throw new Error('原始資料設備與工作不符。');
      if(row.timestamp<contextStart)contextStart=row.timestamp;
      if(row.timestamp>contextEnd)contextEnd=row.timestamp;
      yield row;
    }}
    async function* lines(){
      for await(const rows of processedBlocks(trackedInput(),job,heartbeat))for(const row of rows){
        count++;if(row._background_status!=='COMPLETE')summary.incompleteContext++;
        for(const flags of Object.values(row._quality))for(const flag of flags)summary.flags[flag]=(summary.flags[flag]||0)+1;
        yield JSON.stringify(row)+'\n';
      }
    }
    await pipeline(Readable.from(lines()),createGzip(),createWriteStream(temporary,{flags:'wx',mode:0o600}));
    // Flush before atomically publishing. Consumers only open completed jobs.
    const file=await open(temporary,'r+');try{await file.sync();}finally{await file.close();}
    const digest=await fileDigest(temporary);
    d.exec('BEGIN IMMEDIATE');try{
      heartbeat();await rename(temporary,target);
      d.prepare("UPDATE processing_jobs SET status='COMPLETED',rows_done=?,summary=?,finished_at=?,context_start=?,context_end=?,result_sha256=?,result_bytes=?,lease_until=0,owner=NULL WHERE id=? AND owner=?")
        .run(count,JSON.stringify(summary),new Date().toISOString(),contextStart,contextEnd,digest.sha256,digest.bytes,job.id,job.owner);
      queueProcessingUpload(d,job,digest);d.exec('COMMIT');
    }catch(e){d.exec('ROLLBACK');throw e;}
    return count;
  }catch(e){
    await unlink(temporary).catch(()=>{});
    d.prepare("UPDATE processing_jobs SET status='FAILED',error=?,lease_until=0,owner=NULL WHERE id=? AND owner=? AND status='RUNNING'").run(String(e.message).slice(0,2000),job.id,job.owner);
    throw e;
  }finally{clearInterval(timer);}
}
export async function* readProcessingResult(job,root=processingRoot()){
  const input=createReadStream(await processingResultFile(job,root)),gunzip=createGunzip();
  const pumping=pipeline(input,gunzip);pumping.catch(()=>{});
  const lines=createInterface({input:gunzip,crlfDelay:Infinity});
  try{for await(const line of lines)if(line)yield JSON.parse(line);await pumping;}
  finally{lines.close();input.destroy();gunzip.destroy();await pumping.catch(()=>{});}
}
