import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ensureCleanupSchema,previewCleanup,confirmCleanup,advanceCleanupBatch,runNextCleanup,cleanupStatus,controlCleanup,retryCleanup} from '../lib/processing-cleanup.mjs';
import {claimProcessing} from '../lib/processing-jobs.mjs';
async function fixture(n){const root=await mkdtemp(join(tmpdir(),'aslung-cleanup-batch-')),path=join(root,'fixture.sqlite');let d=new DatabaseSync(path);d.exec("CREATE TABLE devices(id TEXT PRIMARY KEY);INSERT INTO devices VALUES('AL-1');");ensureCleanupSchema(d);
 const ids=[];d.exec('BEGIN');for(let i=0;i<n;i++){const id=randomUUID();ids.push(id);const start=new Date(Date.UTC(2020,0,1+i)),end=new Date(+start+86400000);d.prepare('INSERT INTO processing_jobs(id,device,start,end,recipe,factors,cache_key,actor,created_at,data_kind) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'AL-1',start.toISOString(),end.toISOString(),'{}','[]',id,'test',start.toISOString(),'raw');}d.exec('COMMIT');
 return {get d(){return d;},root,ids,async reopen(){d.close();d=new DatabaseSync(path);},async close(){d.close();await rm(root,{recursive:true,force:true});}};}
const input={actor:'admin',filters:{kind:'raw'},batchMode:true};
const options=f=>({root:f.root,inventory:async()=>[],purge:async()=>{}});
const state=f=>cleanupStatus(f.d).batches[0];
async function confirmed(f){const p=await previewCleanup(f.d,input,options(f));await confirmCleanup(f.d,{id:p.id,actor:'admin',confirmation:'DELETE',pauseSchedules:false},{saveBackup:async()=>'/fixture/backup.sqlite'});return p;}
test('1001 fixed jobs require one confirmation, run 500/500/1 sequentially, survive restart and never include newer jobs',async()=>{
 const f=await fixture(1001);try{let inventory=0,backups=0;
 const p=await previewCleanup(f.d,input,{...options(f),inventory:async()=>{inventory++;return [];}});assert.equal(inventory,0);assert.equal(p.totals.jobs,1001);assert.equal(p.totals.batches,3);assert.equal(p.items.length,50);assert.equal(p.totals.s3Versions,null);
 const confirm=()=>confirmCleanup(f.d,{id:p.id,actor:'admin',confirmation:'DELETE',pauseSchedules:false},{saveBackup:async()=>{backups++;return '/fixture/backup';}});
 await confirm();await confirm();assert.equal(backups,1);assert.equal(claimProcessing(f.d),undefined);
 const added=randomUUID();f.d.prepare("INSERT INTO processing_jobs(id,device,start,end,recipe,factors,cache_key,actor,created_at,data_kind) VALUES(?,'AL-1','2040-01-01T00:00:00Z','2040-01-02T00:00:00Z','{}','[]',?,'new','2040-01-01','raw')").run(added,added);
 await advanceCleanupBatch(f.d,options(f));assert.equal(state(f).current_batch,1);assert.equal(f.d.prepare('SELECT count(*) n FROM processing_cleanup_tasks').get().n,500);assert.equal(await advanceCleanupBatch(f.d,options(f)),null);
 for(let i=0;i<500;i++)assert.equal((await runNextCleanup(f.d,options(f))).status,'DONE');assert.equal(state(f).done,500);assert.equal(state(f).current_batch,1);
 await f.reopen();assert.equal((await runNextCleanup(f.d,options(f))).status,'DONE');assert.equal(state(f).current_batch,2);assert.equal(state(f).done,501);
 for(let i=0;i<499;i++)await runNextCleanup(f.d,options(f));assert.equal(state(f).done,1000);assert.equal(state(f).current_batch,2);
 await runNextCleanup(f.d,options(f));assert.equal(state(f).state,'DONE');assert.equal(state(f).done,1001);assert.equal(state(f).current_batch,3);assert.ok(f.d.prepare('SELECT id FROM processing_jobs WHERE id=?').get(added));
 }finally{await f.close();}
});
test('pause/resume persists; cancellation restores never-started jobs and preserves already deleted results',async()=>{
 const f=await fixture(4);try{const p=await confirmed(f);controlCleanup(f.d,{id:p.id,operation:'pause'},'admin');await f.reopen();assert.equal(await runNextCleanup(f.d,options(f)),null);assert.equal(state(f).state,'PAUSED');
 controlCleanup(f.d,{id:p.id,operation:'resume'},'admin');await runNextCleanup(f.d,options(f));assert.equal(state(f).done,1);
 controlCleanup(f.d,{id:p.id,operation:'cancel'},'admin');assert.equal(state(f).state,'CANCELLED');assert.equal(state(f).cancelled,3);assert.equal(f.d.prepare("SELECT count(*) n FROM processing_jobs WHERE status='QUEUED'").get().n,3);assert.equal(await runNextCleanup(f.d,options(f)),null);
 // Cancelled task audit cannot prevent a fresh explicitly confirmed cleanup.
 await confirmed(f);while(state(f).state!=='DONE')await runNextCleanup(f.d,options(f));assert.equal(f.d.prepare('SELECT count(*) n FROM processing_jobs').get().n,0);
 }finally{await f.close();}
});
test('started work finishes after pause and blocks further claims until resume',async()=>{
 const f=await fixture(2);try{const p=await confirmed(f);const job=f.d.prepare('SELECT * FROM processing_jobs ORDER BY created_at DESC LIMIT 1').get();f.d.prepare('UPDATE processing_jobs SET result_bucket=?,result_region=?,result_key=? WHERE id=?').run('fixture-bucket','ap-northeast-1',`raw/AL-1/2020/01/02/${job.id}/${'a'.repeat(64)}.jsonl.gz`,job.id);
 // Metadata changed after confirmation must halt before any files are deleted.
 await advanceCleanupBatch(f.d,options(f));assert.equal(state(f).state,'FAILED');assert.equal(f.d.prepare('SELECT count(*) n FROM processing_cleanup_tasks').get().n,0);
 controlCleanup(f.d,{id:p.id,operation:'cancel'},'admin');
 const q=await confirmed(f);await runNextCleanup(f.d,{...options(f),purge:async()=>controlCleanup(f.d,{id:q.id,operation:'pause'},'admin')});assert.equal(state(f).state,'PAUSED');assert.equal(state(f).done,1);assert.equal(await runNextCleanup(f.d,options(f)),null);
 controlCleanup(f.d,{id:q.id,operation:'resume'},'admin');await runNextCleanup(f.d,options(f));assert.equal(state(f).state,'DONE');
 }finally{await f.close();}
});
test('failed cloud deletion halts the plan; cancel retains partial work for explicit safe retry',async()=>{
 const f=await fixture(3);try{const job=f.d.prepare('SELECT * FROM processing_jobs ORDER BY created_at DESC LIMIT 1').get();f.d.prepare('UPDATE processing_jobs SET result_bucket=?,result_region=?,result_key=? WHERE id=?').run('fixture-bucket','ap-northeast-1',`raw/AL-1/2020/01/03/${job.id}/${'b'.repeat(64)}.jsonl.gz`,job.id);
 const p=await confirmed(f);const result=await runNextCleanup(f.d,{...options(f),purge:async()=>{throw new Error('AccessDenied');}});assert.equal(result.status,'RETRY');assert.equal(state(f).state,'FAILED');assert.equal(await runNextCleanup(f.d,options(f)),null);
 controlCleanup(f.d,{id:p.id,operation:'cancel'},'admin');assert.equal(state(f).cancelled,2);assert.equal(state(f).state,'FAILED');assert.equal(state(f).cancel_requested,1);assert.equal(f.d.prepare("SELECT status FROM processing_jobs WHERE id=?").get(job.id).status,'DELETING');
 retryCleanup(f.d,result.id);assert.equal(state(f).state,'CANCELLING');await runNextCleanup(f.d,options(f));assert.equal(state(f).state,'CANCELLED');assert.equal(state(f).done,1);assert.equal(state(f).cancelled,2);
 }finally{await f.close();}
});
test('overlapping previews cannot both confirm; source changes and expired confirmations preserve all jobs',async()=>{
 const f=await fixture(3);try{const a=await previewCleanup(f.d,input,options(f)),b=await previewCleanup(f.d,input,options(f));
 const c=id=>confirmCleanup(f.d,{id,actor:'admin',confirmation:'DELETE',pauseSchedules:false},{saveBackup:async()=>'/fixture/backup'});
 await c(a.id);await assert.rejects(c(b.id),e=>e.status===409);assert.equal(f.d.prepare('SELECT count(*) n FROM processing_cleanup_batch_items WHERE plan_id=? AND state=\'PREVIEW\'').get(b.id).n,3);
 controlCleanup(f.d,{id:a.id,operation:'cancel'},'admin');const changed=await previewCleanup(f.d,input,options(f));f.d.prepare("UPDATE processing_jobs SET status='FAILED' WHERE id=?").run(f.ids[0]);await assert.rejects(c(changed.id),e=>e.status===409);assert.equal(f.d.prepare('SELECT count(*) n FROM processing_cleanup_tasks').get().n,0);
 f.d.prepare('UPDATE processing_cleanup_plans SET expires_at=0 WHERE id=?').run(b.id);await assert.rejects(c(b.id),e=>e.status===409);
 }finally{await f.close();}
});
test('cancel during cloud inventory prevents the prepared batch from being queued',async()=>{
 const f=await fixture(1);try{const job=f.d.prepare('SELECT * FROM processing_jobs').get();f.d.prepare('UPDATE processing_jobs SET result_bucket=?,result_region=?,result_key=? WHERE id=?').run('fixture-bucket','ap-northeast-1',`raw/AL-1/2020/01/01/${job.id}/${'a'.repeat(64)}.jsonl.gz`,job.id);
 const p=await confirmed(f);await advanceCleanupBatch(f.d,{...options(f),inventory:async()=>{controlCleanup(f.d,{id:p.id,operation:'cancel'},'admin');return [];}});
 assert.equal(state(f).state,'CANCELLED');assert.equal(f.d.prepare('SELECT count(*) n FROM processing_cleanup_tasks').get().n,0);assert.equal(f.d.prepare('SELECT status FROM processing_jobs').get().status,'QUEUED');
 }finally{await f.close();}
});
test('confirmation backup is serialized and failure leaves no reservations or deletion tasks',async()=>{
 const f=await fixture(2);try{const p=await previewCleanup(f.d,input,options(f));const args={id:p.id,actor:'admin',confirmation:'DELETE',pauseSchedules:false};
 await assert.rejects(confirmCleanup(f.d,args,{saveBackup:async()=>{throw new Error('disk full');}}),/disk full/);assert.equal(f.d.prepare("SELECT count(*) n FROM processing_cleanup_batch_items WHERE state='WAITING'").get().n,0);assert.equal(f.d.prepare('SELECT count(*) n FROM processing_cleanup_tasks').get().n,0);
 let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);let copies=0;
 const first=confirmCleanup(f.d,args,{saveBackup:async()=>{copies++;started();await gate;return '/fixture/backup';}});await ready;
 await assert.rejects(confirmCleanup(f.d,args,{saveBackup:async()=>{copies++;return '/fixture/other';}}),e=>e.status===409);release();await first;assert.equal(copies,1);assert.equal(state(f).state,'RUNNING');
 }finally{await f.close();}
});
test('retry continues failed and remaining work without redoing successful deletes',async()=>{
 const f=await fixture(3);try{
 for(const job of f.d.prepare('SELECT * FROM processing_jobs').all()){const day=job.start.slice(0,10).replaceAll('-','/');f.d.prepare('UPDATE processing_jobs SET result_bucket=?,result_region=?,result_key=? WHERE id=?').run('fixture-bucket','ap-northeast-1',`raw/AL-1/${day}/${job.id}/${'c'.repeat(64)}.jsonl.gz`,job.id);}
 const p=await confirmed(f),calls=[];const purge=async scope=>{calls.push(scope.prefix);if(calls.length===2)throw new Error('temporary network failure');};
 await runNextCleanup(f.d,{...options(f),purge});await runNextCleanup(f.d,{...options(f),purge});assert.equal(state(f).done,1);assert.equal(state(f).state,'FAILED');
 controlCleanup(f.d,{id:p.id,operation:'retry'},'admin');while(state(f).state!=='DONE')await runNextCleanup(f.d,{...options(f),purge});assert.equal(state(f).done,3);assert.equal(calls.filter(prefix=>prefix===calls[0]).length,1);assert.equal(calls.length,4);
 }finally{await f.close();}
});
test('identical test data can be imported again and deleted by a new confirmation; the first plan never deletes new job IDs',async()=>{
 const {enqueueProcessing}=await import('../lib/processing-jobs.mjs');const {ensureArchiveAutomation}=await import('../lib/archive-automation.mjs');
 const f=await fixture(0);try{ensureArchiveAutomation(f.d);const args={device:'AL-1',start:'2026-01-01T00:00:00Z',end:'2026-01-02T00:00:00Z',dataKind:'raw',actor:'test'};
 const first=enqueueProcessing(f.d,args),p=await previewCleanup(f.d,input,options(f));
 const second=enqueueProcessing(f.d,{...args,refresh:'test-again-before-confirm'});assert.notEqual(second,first);
 await confirmCleanup(f.d,{id:p.id,actor:'admin',confirmation:'DELETE',pauseSchedules:false},{saveBackup:async()=>'/fixture/backup'});await runNextCleanup(f.d,options(f));assert.equal(state(f).done,1);assert.ok(f.d.prepare('SELECT id FROM processing_jobs WHERE id=?').get(second));
 const q=await confirmed(f);assert.equal(q.totals.jobs,1);await runNextCleanup(f.d,options(f));assert.equal(f.d.prepare('SELECT count(*) n FROM processing_jobs').get().n,0);assert.equal(f.d.prepare('SELECT count(*) n FROM archive_suppressions').get().n,1);
 const third=enqueueProcessing(f.d,{...args,refresh:'manual-reimport-after-deletion'});assert.ok(third);assert.equal(f.d.prepare('SELECT count(*) n FROM archive_suppressions').get().n,0);
 const r=await confirmed(f);assert.equal(r.totals.jobs,1);await runNextCleanup(f.d,options(f));assert.equal(f.d.prepare('SELECT count(*) n FROM processing_jobs').get().n,0);
 }finally{await f.close();}
});
