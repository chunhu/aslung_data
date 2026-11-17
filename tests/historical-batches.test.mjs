import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createHistoricalBatch,advanceHistoricalBatch,controlHistoricalBatch,historicalBatchStatus,historicalMonths} from '../lib/historical-batches.mjs';
import {ensureProcessingSchema,enqueueProcessing,claimProcessing,runProcessing} from '../lib/processing-jobs.mjs';
import {uploadNextProcessingResult} from '../lib/processing-storage.mjs';
import {previewCleanup} from '../lib/processing-cleanup.mjs';
import {ensureCalibrationSchema} from '../lib/calibration.mjs';
const configuration={mode:'s3',bucket:'aslung-test-bucket',region:'ap-northeast-1'},actor='admin@test',base=resolve('K:/CodexCache/aslung_data/monthly-tests');
const input={devices:['AL-1'],kind:'raw',from:'2025-01-31',to:'2025-02-01'};
function fixture(path=':memory:'){const d=new DatabaseSync(path);d.exec("CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY);INSERT OR IGNORE INTO devices VALUES('AL-1');CREATE TABLE IF NOT EXISTS rawdata(value TEXT);INSERT INTO rawdata VALUES('preserve');");ensureCalibrationSchema(d);ensureProcessingSchema(d);return d;}
const create=(d,p={})=>createHistoricalBatch(d,{...input,...p},actor,configuration);
const advance=(d,window=100)=>advanceHistoricalBatch(d,{configuration,window});
const control=(d,id,operation)=>controlHistoricalBatch(d,{id,operation},actor);
const status=(d,id)=>historicalBatchStatus(d,{id})[0];
function verify(d,id,{rows=3}={}){
 const j=d.prepare('SELECT * FROM processing_jobs WHERE id=?').get(id),hash='a'.repeat(64),key=`raw/${j.device}/2025/01/31/${j.id}/${hash}.jsonl.gz`;
 d.prepare("UPDATE processing_jobs SET status='COMPLETED',rows_done=?,result_sha256=?,result_bytes=10,result_bucket=?,result_region=?,result_key=?,finished_at=? WHERE id=?").run(rows,hash,configuration.bucket,configuration.region,key,new Date().toISOString(),id);
 d.prepare("INSERT INTO processing_uploads(job_id,bucket,region,object_key,sha256,bytes,status) VALUES(?,?,?,?,?,10,'STORED') ON CONFLICT(job_id) DO UPDATE SET status='STORED'").run(id,configuration.bucket,configuration.region,key,hash);
}
test('Taiwan month boundaries preserve partial months, leap days and inclusive end dates',()=>{
 const months=historicalMonths('2024-01-31','2024-03-01');assert.deepEqual(months.map(m=>[m.label,m.days]),[['2024-01',1],['2024-02',29],['2024-03',1]]);
 assert.equal(months[0].start,'2024-01-30T16:00:00.000Z');assert.equal(months[1].end,'2024-02-29T16:00:00.000Z');assert.equal(months.at(-1).end,'2024-03-01T16:00:00.000Z');
 assert.throws(()=>historicalMonths('2025-02-30','2025-03-01'));assert.throws(()=>historicalMonths('2025-03-01','2025-01-01'));
});
test('large requests exceed 5000 units without creating daily jobs; request replay is idempotent and planning is bounded',()=>{
 const d=fixture();try{
  const devices=Array.from({length:100},(_,i)=>'AL-'+(i+1));for(const id of devices)d.prepare('INSERT OR IGNORE INTO devices VALUES(?)').run(id);
  const requestKey=randomUUID(),p={devices,kind:'both',from:'2025-01-01',to:'2025-12-31',requestKey};
  const batch=create(d,p);assert.equal(batch.total,73000);assert.equal(batch.months,12);assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,0);
  assert.equal(create(d,p).id,batch.id);assert.throws(()=>create(d,{...p,to:'2025-11-30'}),e=>e.status===409);
  advance(d,20);let b=status(d,batch.id);assert.equal(b.current.generated,20);assert.equal(b.current.skipped,10);assert.equal(b.current.planned,10);
  for(let n=0;n<10;n++)advance(d,20);b=status(d,batch.id);assert.ok(b.current.planned<=20);assert.ok(b.months.slice(1).every(m=>m.generated===0));
  assert.throws(()=>createHistoricalBatch(d,input,actor,{mode:'local'}),e=>e.status===409);
 }finally{d.close();}
});
test('the next month waits for every S3 verification; progress counts verified rows and completed months',()=>{
 const d=fixture();try{
  const b=create(d);advance(d);const first=d.prepare('SELECT id FROM processing_jobs').get().id;
  d.prepare("UPDATE processing_jobs SET status='COMPLETED',rows_done=3,result_sha256=?,result_bytes=10 WHERE id=?").run('a'.repeat(64),first);
  advance(d);assert.equal(status(d,b.id).current_month,0);assert.equal(status(d,b.id).verified,0);
  verify(d,first);advance(d);assert.equal(status(d,b.id).completed_months,1);assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,1);
  advance(d);const second=d.prepare('SELECT id FROM processing_jobs WHERE id<>?').get(first).id;
  assert.equal(status(d,b.id).current.label,'2025-02');verify(d,second,{rows:7});advance(d);
  const done=status(d,b.id);assert.equal(done.status,'COMPLETED');assert.equal(done.verified,2);assert.equal(done.completed_months,2);assert.equal(done.raw_rows,10);
 }finally{d.close();}
});
test('pause blocks new claims and uploads; resume and retry continue the same month without duplicate jobs',async()=>{
 const d=fixture();try{
  const b=create(d,{to:'2025-02-02'});advance(d);control(d,b.id,'pause');assert.equal(claimProcessing(d),undefined);assert.equal(advance(d),null);
  assert.equal(status(d,b.id).status,'PAUSED');control(d,b.id,'resume');const claimed=claimProcessing(d);assert.ok(claimed);
  d.prepare("UPDATE processing_jobs SET status='FAILED',error='source unavailable' WHERE id=?").run(claimed.id);advance(d);
  assert.equal(status(d,b.id).status,'FAILED');assert.match(status(d,b.id).error,/source unavailable/);control(d,b.id,'retry');assert.equal(status(d,b.id).status,'RUNNING');
  assert.equal(d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(claimed.id).status,'QUEUED');assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,1);
  verify(d,claimed.id);d.prepare("UPDATE processing_uploads SET status='RETRY',last_error='access denied' WHERE job_id=?").run(claimed.id);advance(d);assert.equal(status(d,b.id).status,'FAILED');control(d,b.id,'retry');assert.equal(d.prepare('SELECT status,retry_at FROM processing_uploads WHERE job_id=?').get(claimed.id).status,'PENDING');
 }finally{d.close();}
});
test('cancellation retains completed data, stops queued jobs, reaps expired in-flight jobs and does not poison a new request',()=>{
 const d=fixture();try{
  const b=create(d,{from:'2025-01-30'});advance(d);const refs=d.prepare('SELECT job_id FROM historical_batch_jobs ORDER BY ordinal').all();
  verify(d,refs[0].job_id);d.prepare("UPDATE processing_jobs SET status='RUNNING',lease_until=0 WHERE id=?").run(refs[1].job_id);
  control(d,b.id,'cancel');assert.equal(status(d,b.id).status,'CANCELLED');assert.equal(advance(d),null);
  assert.equal(d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(refs[0].job_id).status,'COMPLETED');assert.equal(d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(refs[1].job_id).status,'CANCELLED');
  assert.throws(()=>control(d,b.id,'resume'),e=>e.status===409);
  const next=create(d,{from:'2025-01-30'});advance(d);const nextIds=d.prepare('SELECT job_id FROM historical_batch_jobs WHERE batch_id=? ORDER BY ordinal').all(next.id);
  assert.equal(nextIds[0].job_id,refs[0].job_id);assert.notEqual(nextIds[1].job_id,refs[1].job_id);assert.equal(d.prepare('SELECT value FROM rawdata').get().value,'preserve');
 }finally{d.close();}
});
test('reused jobs remain runnable for independent work or another active batch',()=>{
 const d=fixture();try{
  const existing=enqueueProcessing(d,{device:'AL-1',start:'2025-01-30T16:00:00Z',end:'2025-01-31T16:00:00Z',dataKind:'raw',actor});
  const one=create(d);advance(d);assert.equal(d.prepare('SELECT owned FROM historical_batch_jobs WHERE batch_id=?').get(one.id).owned,0);
  control(d,one.id,'pause');assert.equal(claimProcessing(d).id,existing);
  d.prepare("UPDATE processing_jobs SET status='QUEUED',owner=NULL,lease_until=0 WHERE id=?").run(existing);
  const two=create(d);advance(d);control(d,two.id,'cancel');assert.equal(d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(existing).status,'QUEUED');
 }finally{d.close();}
});
test('another active batch can use a job owned by a paused batch without losing shared work on cancellation',()=>{
 const d=fixture();try{
  const one=create(d);advance(d);const id=d.prepare('SELECT job_id FROM historical_batch_jobs').get().job_id;control(d,one.id,'pause');assert.equal(claimProcessing(d),undefined);
  const two=create(d);advance(d);assert.equal(d.prepare('SELECT job_id FROM historical_batch_jobs WHERE batch_id=?').get(two.id).job_id,id);
  control(d,one.id,'cancel');assert.equal(d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(id).status,'QUEUED');assert.equal(claimProcessing(d).id,id);
 }finally{d.close();}
});
test('missing coefficients count as explicit skips and never advance past an unverified original',()=>{
 const d=fixture();try{
  const b=create(d,{to:input.from,kind:'both'});advance(d);let current=status(d,b.id);assert.equal(current.current.skipped,1);assert.equal(current.current.total,2);assert.equal(current.status,'RUNNING');
  advance(d);assert.equal(status(d,b.id).completed_months,0);const id=d.prepare('SELECT id FROM processing_jobs').get().id;verify(d,id);advance(d);current=status(d,b.id);assert.equal(current.status,'COMPLETED');assert.equal(current.verified,1);assert.equal(current.skipped,1);
 }finally{d.close();}
});
test('cancelled stale upload leases are released for cleanup without starting another upload',async()=>{
 const d=fixture();try{
  const b=create(d);advance(d);const id=d.prepare('SELECT id FROM processing_jobs').get().id;verify(d,id);d.prepare("UPDATE processing_uploads SET status='UPLOADING',lease_until=0 WHERE job_id=?").run(id);
  control(d,b.id,'cancel');advance(d);assert.equal(d.prepare('SELECT status FROM processing_uploads').get().status,'CANCELLED');
  const plan=await previewCleanup(d,{actor,filters:{kind:'raw'}},{root:join(base,'missing'),inventory:async()=>[]});assert.equal(plan.items.length,1);
 }finally{d.close();}
});
test('uncompleted current batch work cannot be cleaned silently; cancellation releases cleanup protection',async()=>{
 const d=fixture();try{
  const b=create(d);advance(d);const options={root:join(base,'missing'),inventory:async()=>[]};
  await assert.rejects(previewCleanup(d,{actor,filters:{kind:'raw'}},options),e=>e.status===409);
  control(d,b.id,'cancel');assert.equal((await previewCleanup(d,{actor,filters:{kind:'raw'}},options)).items.length,1);
 }finally{d.close();}
});
test('worker restart preserves paused batches and reclaims interrupted work only after resume',async()=>{
 await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'restart-')),path=join(root,'state.sqlite');let d=fixture(path);
 try{
  const b=create(d);advance(d);const j=claimProcessing(d);control(d,b.id,'pause');d.prepare('UPDATE processing_jobs SET lease_until=0 WHERE id=?').run(j.id);d.close();d=new DatabaseSync(path);
  assert.equal(status(d,b.id).status,'PAUSED');assert.equal(claimProcessing(d),undefined);control(d,b.id,'resume');assert.equal(claimProcessing(d).id,j.id);assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,1);
 }finally{d.close();if(!resolve(root).startsWith(base+sep))throw new Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}
});
test('an in-flight upload may finish after pause, but no next month starts until resume',async()=>{
 await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'upload-')),d=fixture(),previous={};
 for(const [key,value] of Object.entries({CALIBRATION_STORAGE:'s3',S3_BUCKET:configuration.bucket,AWS_REGION:configuration.region})){previous[key]=process.env[key];process.env[key]=value;}
 try{
  const b=create(d);advance(d);const j=claimProcessing(d);await runProcessing(d,j,[],root);control(d,b.id,'pause');assert.equal(await uploadNextProcessingResult(d,{root,upload:async()=>assert.fail('paused upload')}),null);
  control(d,b.id,'resume');const uploaded=await uploadNextProcessingResult(d,{root,upload:async()=>control(d,b.id,'pause')});assert.equal(uploaded.status,'STORED');assert.equal(status(d,b.id).verified,1);advance(d);assert.equal(status(d,b.id).current_month,0);
  control(d,b.id,'resume');advance(d);assert.equal(status(d,b.id).current_month,1);
 }finally{d.close();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;if(!resolve(root).startsWith(base+sep))throw new Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}
});
