import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,stat,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {gzipSync} from 'node:zlib';
import {previewCleanup,confirmCleanup,runNextCleanup,cleanupStatus,retryCleanup,ensureCleanupSchema} from '../lib/processing-cleanup.mjs';
import {processingResultFile} from '../lib/processing-storage.mjs';
import {cleanupObjectVersions,purgeCleanupScope} from '../lib/processing-cleanup-s3.mjs';
import {claimProcessing} from '../lib/processing-jobs.mjs';
import {ensureGlobalProcessingSchema} from '../lib/global-processing.mjs';

async function fixture(){
  const d=new DatabaseSync(':memory:');d.exec("PRAGMA foreign_keys=ON;CREATE TABLE devices(id TEXT PRIMARY KEY);INSERT INTO devices VALUES('AL-1');CREATE TABLE rawdata(value TEXT);INSERT INTO rawdata VALUES('keep');CREATE TABLE members(email TEXT);INSERT INTO members VALUES('keep');");
  ensureCleanupSchema(d);ensureGlobalProcessingSchema(d);d.prepare('UPDATE processing_global SET enabled=1').run();
  d.prepare("INSERT INTO processing_schedules(device,up_limit,enabled,updated_by) VALUES('AL-1',3,1,'test')").run();
  const root=await mkdtemp(join(process.cwd(),'.tools','cleanup-test-')),hash='a'.repeat(64);
  async function job({status='COMPLETED',remote=false,uploadStatus='STORED',extra=''}={}){
    const id=randomUUID();
    d.prepare(`INSERT INTO processing_jobs(id,device,start,end,recipe,factors,cache_key,status,actor,created_at,result_sha256,result_bytes)
      VALUES(?,'AL-1','2026-10-01T16:00:00.000Z','2026-10-02T16:00:00.000Z','{}','[]',?,?,'test','2026-10-03',?,4)`).run(id,id,status,hash);
    await writeFile(join(root,id+'.jsonl.gz'),'data');
    if(extra)await writeFile(join(root,id+'.jsonl.gz.'+randomUUID()+'.'+extra),'temporary');
    if(remote){
      const key=`processed/AL-1/2026/10/02/${id}/${hash}.jsonl.gz`;
      d.prepare('UPDATE processing_jobs SET result_bucket=?,result_region=?,result_key=? WHERE id=?').run('aslung-test-bucket','ap-northeast-1',key,id);
      d.prepare('INSERT INTO processing_uploads(job_id,bucket,region,object_key,sha256,bytes,status) VALUES(?,?,?,?,?,4,?)').run(id,'aslung-test-bucket','ap-northeast-1',key,hash,uploadStatus);
    }
    return id;
  }
  const options={root,inventory:async()=>[{bytes:10},{bytes:20}]};
  const preview=()=>previewCleanup(d,{actor:'admin',filters:{}},options);
  const confirm=id=>confirmCleanup(d,{id,actor:'admin',confirmation:'DELETE',pauseSchedules:true},{saveBackup:async()=>'/test/backup.sqlite'});
  return {d,root,job,preview,confirm,options,async close(){d.close();await rm(root,{recursive:true,force:true});}};
}

test('preview is read-only and excludes running/uploading jobs while counting versions and local temp files',async()=>{
  const f=await fixture();try{
    const id=await f.job({remote:true,extra:'tmp'});await f.job({status:'RUNNING'});await f.job({remote:true,uploadStatus:'UPLOADING'});
    const plan=await f.preview();assert.deepEqual(plan.totals,{jobs:1,excluded:2,localFiles:2,localBytes:13,s3Versions:2,s3Bytes:30});
    assert.equal(f.d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(id).status,'COMPLETED');assert.equal(cleanupStatus(f.d).tasks.length,0);
    assert.equal(await readFile(join(f.root,id+'.jsonl.gz'),'utf8'),'data');
  }finally{await f.close();}
});
test('confirm pins the preview, backs up first, pauses scheduling and blocks processing and result queries',async()=>{
  const f=await fixture();try{
    const id=await f.job({status:'QUEUED'}),plan=await f.preview();
    await assert.rejects(()=>confirmCleanup(f.d,{id:plan.id,actor:'other',confirmation:'DELETE',pauseSchedules:true}),e=>e.status===404);
    await assert.rejects(()=>confirmCleanup(f.d,{id:plan.id,actor:'admin',confirmation:'no',pauseSchedules:true}),e=>e.status===400);
    await assert.rejects(()=>confirmCleanup(f.d,{id:plan.id,actor:'admin',confirmation:'DELETE',pauseSchedules:true},{saveBackup:async()=>{throw new Error('backup failed');}}),/backup failed/);
    assert.equal(f.d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(id).status,'QUEUED');
    await f.confirm(plan.id);assert.equal((await f.confirm(plan.id)).reused,true);assert.equal(cleanupStatus(f.d).tasks.length,1);
    assert.equal(f.d.prepare('SELECT enabled FROM processing_global').get().enabled,0);assert.equal(f.d.prepare('SELECT enabled FROM processing_schedules').get().enabled,0);
    assert.equal(claimProcessing(f.d),undefined);assert.equal(f.d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(id).status,'DELETING');
  }finally{await f.close();}
});
test('changed jobs, expired previews, invalid filters and unsafe S3 references cannot be confirmed',async()=>{
  const f=await fixture();try{
    const id=await f.job({remote:true}),plan=await f.preview();f.d.prepare("UPDATE processing_uploads SET status='UPLOADING' WHERE job_id=?").run(id);
    await assert.rejects(()=>f.confirm(plan.id),e=>e.status===409);assert.equal(cleanupStatus(f.d).tasks.length,0);
    f.d.prepare("UPDATE processing_uploads SET status='STORED' WHERE job_id=?").run(id);
    f.d.prepare('UPDATE processing_cleanup_plans SET expires_at=0').run();await assert.rejects(()=>f.confirm(plan.id),e=>e.status===409);
    for(const filters of [{from:'2026-02-30'},{device:0},{foo:''}])await assert.rejects(()=>previewCleanup(f.d,{actor:'admin',filters},f.options),e=>e.status===400);
    f.d.prepare("UPDATE processing_jobs SET result_key='processed/other/object' WHERE id=?").run(id);await assert.rejects(()=>f.preview(),e=>e.status===409);
  }finally{await f.close();}
});
test('failed cloud deletion preserves local files and work records; retry finishes idempotently and invalidates snapshots',async()=>{
  const f=await fixture();try{
    const id=await f.job({remote:true,extra:'download'}),other=await f.job({status:'RUNNING'}),plan=await f.preview();await f.confirm(plan.id);
    f.d.exec('CREATE TABLE processing_query_snapshots(id TEXT,pieces TEXT)');f.d.prepare('INSERT INTO processing_query_snapshots VALUES(?,?)').run('old',JSON.stringify([{id}]));f.d.prepare('INSERT INTO processing_query_snapshots VALUES(?,?)').run('other',JSON.stringify([{id:other}]));
    const failed=await runNextCleanup(f.d,{root:f.root,purge:async()=>{throw Object.assign(new Error('denied'),{name:'AccessDenied'});}});
    assert.equal(failed.status,'RETRY');assert.match(failed.error,/權限不足/);assert.equal(await readFile(join(f.root,id+'.jsonl.gz'),'utf8'),'data');
    await assert.rejects(()=>processingResultFile({id},f.root),e=>e.status===410);
    retryCleanup(f.d,failed.id);let purged=0;
    assert.equal((await runNextCleanup(f.d,{root:f.root,purge:async scope=>{assert.ok(scope.prefix.includes(id));purged++;}})).status,'DONE');assert.equal(purged,1);
    assert.equal(f.d.prepare('SELECT * FROM processing_jobs WHERE id=?').get(id),undefined);assert.equal(f.d.prepare('SELECT * FROM processing_uploads WHERE job_id=?').get(id),undefined);
    assert.deepEqual(f.d.prepare('SELECT id FROM processing_query_snapshots').all().map(r=>r.id),['other']);
    assert.ok((await readdir(f.root)).includes(id+'.jsonl.gz.deleted'));assert.equal(await readFile(join(f.root,other+'.jsonl.gz'),'utf8'),'data');
    assert.equal(f.d.prepare('SELECT value FROM rawdata').get().value,'keep');assert.equal(f.d.prepare('SELECT email FROM members').get().email,'keep');
    assert.equal(await runNextCleanup(f.d,{root:f.root}),null);
  }finally{await f.close();}
});
test('an in-flight S3 restore cannot recreate a deleted result file',async()=>{
  const f=await fixture();try{
    const id=await f.job({remote:true}),job=f.d.prepare('SELECT * FROM processing_jobs WHERE id=?').get(id),body=gzipSync('{}\n');
    job.result_bytes=body.length;job.result_sha256=createHash('sha256').update(body).digest('hex');
    const {unlink}=await import('node:fs/promises');await unlink(join(f.root,id+'.jsonl.gz'));
    let entered,finish;const ready=new Promise(resolve=>{entered=resolve;}),pending=new Promise(resolve=>{finish=resolve;});
    const restore=processingResultFile(job,f.root,async()=>{entered();await pending;return {ContentLength:body.length,Body:Readable.from([body])};});
    await ready;const plan=await f.preview();await f.confirm(plan.id);await runNextCleanup(f.d,{root:f.root,purge:async()=>{}});
    finish();await assert.rejects(()=>restore,e=>e.status===410);await assert.rejects(()=>stat(join(f.root,id+'.jsonl.gz')),e=>e.code==='ENOENT');
  }finally{await f.close();}
});
test('interrupted cleanup leases can resume while completed audit entries remain',async()=>{
  const f=await fixture();try{
    await f.job();await f.confirm((await f.preview()).id);f.d.prepare("UPDATE processing_cleanup_tasks SET state='RUNNING',owner='old',lease_until=0").run();
    assert.equal((await runNextCleanup(f.d,{root:f.root})).status,'DONE');assert.equal(cleanupStatus(f.d).counts[0].state,'DONE');
  }finally{await f.close();}
});

const scope={bucket:'aslung-test-bucket',region:'ap-northeast-1',prefix:`processed/AL-1/2026/10/02/${randomUUID()}/`};
test('S3 cleanup removes exact object versions and delete markers, verifies empty and rejects partial errors',async()=>{
  const key=scope.prefix+'a'.repeat(64)+'.jsonl.gz';let objects=[{Key:key,VersionId:'v1',Size:4},{Key:key,VersionId:'marker'}],deleted;
  const client={send:async command=>{
    if(command.constructor.name==='GetBucketVersioningCommand')return {Status:'Enabled'};
    if(command.constructor.name==='ListObjectVersionsCommand')return {Versions:objects.filter(r=>r.Size),DeleteMarkers:objects.filter(r=>!r.Size)};
    deleted=command.input.Delete.Objects;objects=[];return {};
  }};
  assert.equal(await purgeCleanupScope(scope,()=>{},client),2);assert.deepEqual(deleted,[{Key:key,VersionId:'v1'},{Key:key,VersionId:'marker'}]);
  objects=[{Key:key,VersionId:'v2',Size:4}];
  await assert.rejects(()=>purgeCleanupScope(scope,()=>{},{send:async command=>command.constructor.name==='DeleteObjectsCommand'?{Errors:[{Code:'AccessDenied'}]}:client.send(command)}),/AccessDenied/);
  await assert.rejects(()=>cleanupObjectVersions({...scope,prefix:'processed/'},client),/路徑不正確/);
});
test('unversioned S3 deletes omit version IDs and version listing follows both pagination markers',async()=>{
  const key=scope.prefix+'b'.repeat(64)+'.jsonl.gz';let listCalls=0,deleted=false;
  const client={send:async command=>{
    if(command.constructor.name==='GetBucketVersioningCommand')return {};
    if(command.constructor.name==='DeleteObjectsCommand'){assert.deepEqual(command.input.Delete.Objects,[{Key:key}]);deleted=true;return {};}
    if(deleted)return {};
    listCalls++;if(listCalls===1)return {Versions:[{Key:key,VersionId:'null',Size:10}],IsTruncated:true,NextKeyMarker:key,NextVersionIdMarker:'null'};
    assert.equal(command.input.KeyMarker,key);assert.equal(command.input.VersionIdMarker,'null');return {};
  }};
  await purgeCleanupScope(scope,()=>{},client);assert.equal(listCalls,2);
});
