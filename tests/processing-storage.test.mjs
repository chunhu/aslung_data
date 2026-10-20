import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,unlink,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {ensureProcessingSchema,runProcessing,readProcessingResult,resultPath} from '../lib/processing-jobs.mjs';
import {processingRecipe} from '../lib/measurement-processing.mjs';
import {storageConfiguration,fileDigest,uploadResultFile,s3Client} from '../lib/s3-storage.mjs';
import {uploadNextProcessingResult,processingResultFile} from '../lib/processing-storage.mjs';
import {preparedProcessedQuery} from '../lib/processed-query.mjs';

async function fixture(){
  const root=await mkdtemp(join(process.cwd(),'.tools','s3-storage-test-')),d=new DatabaseSync(':memory:');
  ensureProcessingSchema(d);const id=randomUUID(),owner=randomUUID();
  d.prepare(`INSERT INTO processing_jobs(id,device,start,end,recipe,factors,cache_key,status,owner,lease_until,actor,created_at)
    VALUES(?,'AL-1','2026-10-19T16:00:00.000Z','2026-10-20T16:00:00.000Z',?,'[]',?,'RUNNING',?,?,'test',?)`)
    .run(id,JSON.stringify(processingRecipe()),id,owner,Date.now()+120000,new Date().toISOString());
  const job=()=>d.prepare('SELECT * FROM processing_jobs WHERE id=?').get(id);
  return {d,id,root,job,async close(){d.close();assert.ok(root.startsWith(resolve('.tools')+'\\')||root.startsWith(resolve('.tools')+'/'));await rm(root,{recursive:true,force:true});}};
}
async function withS3(run){
  const keys=['CALIBRATION_STORAGE','S3_BUCKET','AWS_REGION'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{CALIBRATION_STORAGE:'s3',S3_BUCKET:'aslung-test-bucket',AWS_REGION:'ap-northeast-1'});
  try{await run();}finally{for(const k of keys)if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}
}
const input=[{aslung_id:'AL-1',timestamp:'2026-10-20T00:00:00.000Z',PM1_G3:1,'PM2.5_G3':2,PM10_G3:3}];

test('S3 configuration is opt-in, requires bucket/region, and rejects invalid modes',()=>{
  assert.deepEqual(storageConfiguration({}),{mode:'local'});
  assert.throws(()=>storageConfiguration({CALIBRATION_STORAGE:'wrong'}));
  assert.throws(()=>storageConfiguration({CALIBRATION_STORAGE:'s3'}));
  assert.throws(()=>storageConfiguration({CALIBRATION_STORAGE:'s3',S3_BUCKET:'s3://bucket',AWS_REGION:'ap-northeast-1'}));
  assert.equal(storageConfiguration({CALIBRATION_STORAGE:'s3',S3_BUCKET:'aslung-test',AWS_REGION:'ap-northeast-1'}).mode,'s3');
});
test('local mode publishes existing gzip results and never queues or contacts S3',async()=>{
  const before=process.env.CALIBRATION_STORAGE;process.env.CALIBRATION_STORAGE='local';const f=await fixture();
  try{
    await runProcessing(f.d,f.job(),input,f.root);
    assert.equal(f.job().status,'COMPLETED');assert.equal(f.job().result_sha256.length,64);
    assert.equal(f.d.prepare('SELECT COUNT(*) n FROM processing_uploads').get().n,0);
    assert.equal(await uploadNextProcessingResult(f.d,{upload:()=>{throw Error('unexpected');}}),null);
    const rows=[];for await(const row of readProcessingResult(f.job(),f.root))rows.push(row);
    assert.equal(rows.length,1);assert.equal(rows[0].aslung_id,'AL-1');
  }finally{await f.close();if(before===undefined)delete process.env.CALIBRATION_STORAGE;else process.env.CALIBRATION_STORAGE=before;}
});
test('upload failure preserves completed local data and retries without recalculating or exposing credentials',async()=>withS3(async()=>{
  const f=await fixture();try{
    await runProcessing(f.d,f.job(),input,f.root);
    const task=f.d.prepare('SELECT * FROM processing_uploads').get();
    assert.equal(task.status,'PENDING');assert.match(task.object_key,/^processed\/AL-1\/2026\/10\/20\//);
    let calls=0;
    const failed=await uploadNextProcessingResult(f.d,{root:f.root,upload:async()=>{calls++;throw Object.assign(new Error('do not expose this credential'),{name:'AccessDenied',$metadata:{httpStatusCode:403}});}});
    assert.equal(failed.status,'RETRY');assert.doesNotMatch(failed.error,/credential/);assert.equal(f.job().status,'COMPLETED');
    assert.ok((await readFile(resultPath(f.root,f.id))).length>0);assert.equal(f.job().result_key,null);
    assert.equal(await uploadNextProcessingResult(f.d,{root:f.root,upload:()=>{calls++;}}),null);assert.equal(calls,1);
    f.d.prepare('UPDATE processing_uploads SET retry_at=0').run();
    const done=await uploadNextProcessingResult(f.d,{root:f.root,upload:async upload=>{
      calls++;assert.equal(upload.bucket,'aslung-test-bucket');assert.equal(upload.region,'ap-northeast-1');
      assert.equal((await fileDigest(upload.path)).sha256,upload.sha256);
    }});
    assert.equal(done.status,'STORED');assert.equal(f.job().result_key,task.object_key);
    assert.equal(f.d.prepare('SELECT attempts FROM processing_uploads').get().attempts,2);
    assert.equal(await uploadNextProcessingResult(f.d,{root:f.root,upload:()=>{throw Error('duplicate upload');}}),null);
  }finally{await f.close();}
}));
test('missing local files can be restored from the exact verified S3 object; corruption never becomes a cache hit',async()=>withS3(async()=>{
  const f=await fixture();try{
    await runProcessing(f.d,f.job(),input,f.root);const saved=await readFile(resultPath(f.root,f.id));
    await uploadNextProcessingResult(f.d,{root:f.root,upload:async()=>{}});
    await unlink(resultPath(f.root,f.id));let gets=0;
    const download=async job=>{gets++;assert.equal(job.result_bucket,'aslung-test-bucket');return {ContentLength:saved.length,Body:Readable.from([saved])};};
    assert.equal(await processingResultFile(f.job(),f.root,download),resultPath(f.root,f.id));
    assert.deepEqual(await readFile(resultPath(f.root,f.id)),saved);
    await processingResultFile(f.job(),f.root,()=>{throw Error('should use local');});assert.equal(gets,1);
    await unlink(resultPath(f.root,f.id));const corrupt=Buffer.from(saved);corrupt[0]^=255;
    await assert.rejects(()=>processingResultFile(f.job(),f.root,async()=>({ContentLength:saved.length,Body:Readable.from([corrupt])})),e=>e.status===503);
    assert.deepEqual(await readdir(f.root),[]);
    await assert.rejects(()=>processingResultFile({...f.job(),result_key:null},f.root,download),e=>e.status===409);
  }finally{await f.close();}
}));
test('upload sends the actual SHA256 and confirms stored length and checksum before publishing a remote reference',async()=>{
  const f=await fixture();try{
    const path=join(f.root,'probe'),content=Buffer.from('test upload');await writeFile(path,content);const digest=await fileDigest(path),calls=[];
    const client={async send(command){calls.push(command);if(command.constructor.name==='PutObjectCommand'){
      const chunks=[];for await(const chunk of command.input.Body)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),content);
      assert.equal(command.input.ChecksumSHA256,createHash('sha256').update(content).digest('base64'));assert.equal(command.input.ServerSideEncryption,'AES256');return {};
    }return {ContentLength:digest.bytes,ChecksumSHA256:Buffer.from(digest.sha256,'hex').toString('base64'),Metadata:{sha256:digest.sha256}};}};
    await uploadResultFile({path,...digest,bucket:'test-bucket',region:'ap-northeast-1',key:'processed/test'},client);assert.equal(calls.length,2);
    await assert.rejects(()=>uploadResultFile({path,...digest,bucket:'test-bucket',region:'ap-northeast-1',key:'processed/test'},{async send(command){return command.constructor.name==='PutObjectCommand'?{}:{ContentLength:0};}}),/驗證失敗/);
  }finally{await f.close();}
});
test('processed queries authorize context before contacting S3 and can query a result restored from S3',async()=>withS3(async()=>{
  const f=await fixture(),client=s3Client('ap-northeast-1'),originalSend=client.send;let reads=0;
  try{
    await runProcessing(f.d,f.job(),input,f.root);const saved=await readFile(resultPath(f.root,f.id));
    await uploadNextProcessingResult(f.d,{root:f.root,upload:async()=>{}});await unlink(resultPath(f.root,f.id));
    client.send=async command=>{reads++;assert.equal(command.constructor.name,'GetObjectCommand');assert.equal(command.input.Key,f.job().result_key);return {ContentLength:saved.length,Body:Readable.from([saved])};};
    const parameters={id:'AL-1',start:input[0].timestamp,end:input[0].timestamp,ranges:[{start:input[0].timestamp,end:input[0].timestamp}],root:f.root};
    await assert.rejects(()=>preparedProcessedQuery(f.d,{...parameters,authorize:async()=>{throw Object.assign(new Error('forbidden'),{status:403});}}),e=>e.status===403);
    assert.equal(reads,0);
    const query=await preparedProcessedQuery(f.d,{...parameters,authorize:async job=>{assert.equal(job.device,'AL-1');assert.ok(job.context_start);}});
    const rows=[];for await(const row of query.rows())rows.push(row);
    assert.equal(rows.length,1);assert.equal(rows[0].aslung_id,'AL-1');assert.equal(reads,1);
  }finally{client.send=originalSend;await f.close();}
}));
