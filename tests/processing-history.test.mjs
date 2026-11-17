import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,mkdtemp,rm,readFile,unlink} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {Readable} from 'node:stream';
import {enqueueHistorical} from '../lib/processing-history.mjs';
import {ensureProcessingSchema,enqueueProcessing,claimProcessing,runProcessing,readProcessingResult,resultPath} from '../lib/processing-jobs.mjs';
import {uploadNextProcessingResult} from '../lib/processing-storage.mjs';
import {preparedProcessedQuery} from '../lib/processed-query.mjs';
import {previewCleanup,confirmCleanup,runNextCleanup} from '../lib/processing-cleanup.mjs';
import {rawProcessingRows} from '../lib/processing-raw.mjs';
import * as cal from '../lib/calibration.mjs';
const base=resolve('K:/CodexCache/aslung_data/history-tests');
function fixture(){const d=new DatabaseSync(':memory:');d.exec("CREATE TABLE devices(id TEXT PRIMARY KEY);INSERT INTO devices VALUES('AL-1'),('AL-2');CREATE TABLE rawdata(value TEXT);INSERT INTO rawdata VALUES('preserve');");cal.ensureCalibrationSchema(d);ensureProcessingSchema(d);return d;}
const p={devices:['AL-1'],from:'2025-01-01',to:'2025-01-02',kind:'both',upLimit:3},configuration={mode:'s3'};
test('historical batches split Taiwan days, preserve raw jobs without factors and reuse identical versions',()=>{
 const d=fixture();try{
  assert.throws(()=>enqueueHistorical(d,p,'admin',{mode:'local'}),e=>e.status===409);
  const result=enqueueHistorical(d,p,'admin',configuration);assert.equal(result.created,2);assert.equal(result.skipped,2);
  const rows=d.prepare('SELECT * FROM processing_jobs ORDER BY start').all();assert.equal(rows[0].start,'2024-12-31T16:00:00.000Z');assert.equal(rows[1].end,'2025-01-02T16:00:00.000Z');assert.ok(rows.every(j=>j.data_kind==='raw'));
  assert.equal(enqueueHistorical(d,p,'admin',configuration).reused,2);
  assert.equal(enqueueHistorical(d,{...p,refresh:true},'admin',configuration).created,2);
  assert.throws(()=>enqueueHistorical(d,{...p,devices:['AL-1','MISSING']},'admin',configuration),e=>e.status===404);
  assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,4);
  for(const change of [{to:'2024-12-31'},{from:'2025-02-30'},{kind:'invalid'},{devices:[]},{from:'2010-01-01'},{devices:['AL-1'],from:'2015-01-01',to:'2024-01-01'}])assert.throws(()=>enqueueHistorical(d,{...p,...change},'admin',configuration));
 }finally{d.close();}
});
test('original archive reads use bounded source SELECTs without calibration context rows',async()=>{
 let calls=0;const pool={query:async({sql,values})=>{calls++;assert.match(sql,/SELECT rawdata\.\*/);assert.doesNotMatch(sql,/LIMIT 25|UPDATE|DELETE|INSERT/);assert.deepEqual(values.slice(0,1),['AL-1']);return [[{id:'123',aslung_id:'AL-1',time:new Date('2025-01-01Z'),ch1:'-2',battery:'4.1'}]];}};
 const out=[];for await(const row of rawProcessingRows(pool,{data_kind:'raw',device:'AL-1',start:'2024-12-31T16:00:00Z',end:'2025-01-01T16:00:00Z'}))out.push(row);
 assert.equal(calls,1);assert.equal(out[0].ch1,'-2');assert.equal(out[0].battery,'4.1');
});
test('originals stream unchanged to verified S3, restore for queries and clean independently by multiple IDs and dates',async()=>{
 await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'raw-')),d=fixture(),previous={};
 for(const [key,value] of Object.entries({CALIBRATION_STORAGE:'s3',S3_BUCKET:'aslung-test-bucket',AWS_REGION:'ap-northeast-1'})){previous[key]=process.env[key];process.env[key]=value;}
 try{
  enqueueHistorical(d,{...p,kind:'raw'},'admin',configuration);
  const first=claimProcessing(d),raw={id:'123',aslung_id:'AL-1',timestamp:'2025-01-01T00:00:00.000Z',ch1:'-2',battery:'4.1'};
  assert.equal(await runProcessing(d,first,[raw],root),1);
  const originals=[];for await(const row of readProcessingResult(first,root))originals.push(row);assert.deepEqual(originals,[raw]);
  const upload=d.prepare('SELECT * FROM processing_uploads WHERE job_id=?').get(first.id);assert.match(upload.object_key,/^raw\/AL-1\/2025\/01\/01\//);
  const bytes=await readFile(resultPath(root,first.id));
  assert.equal((await uploadNextProcessingResult(d,{root,upload:async info=>{assert.equal(info.bytes,bytes.length);}})).status,'STORED');
  const end='2025-01-01T15:59:59.999Z',ranges=[{start:first.start,end}],args={id:'AL-1',start:first.start,end,ranges,root,authorize:async()=>{}};
  const query=await preparedProcessedQuery(d,{...args,dataKind:'raw'});assert.match(query.snapshot,/^raw:/);
  const values=[];for await(const row of query.rows())values.push(row);assert.equal(values.length,1);assert.equal(values[0].ch1,'-2');assert.equal(values[0]._archive_job_id,first.id);
  await assert.rejects(preparedProcessedQuery(d,args),e=>e.status===409);
  await assert.rejects(preparedProcessedQuery(d,{...args,dataKind:'processed',snapshot:query.snapshot}),e=>e.status===400);
  // Restore via the shared verified S3 reader, using an injected object fetcher.
  await unlink(resultPath(root,first.id));const {processingResultFile}=await import('../lib/processing-storage.mjs');const stored=d.prepare('SELECT * FROM processing_jobs WHERE id=?').get(first.id);
  await processingResultFile(stored,root,async()=>({ContentLength:bytes.length,Body:Readable.from([bytes])}));
  const second=d.prepare("SELECT id FROM processing_jobs WHERE status='QUEUED'").get().id;
  const inventory=async scope=>{assert.match(scope.prefix,/^raw\//);return [{bytes:bytes.length}];};
  const plan=await previewCleanup(d,{actor:'admin',filters:{kind:'raw',devices:['AL-1','AL-2'],from:'2025-01-01',to:'2025-01-01'}},{root,inventory});
  assert.deepEqual(plan.items.map(i=>i.id),[first.id]);
  await confirmCleanup(d,{id:plan.id,actor:'admin',confirmation:'DELETE',pauseSchedules:false},{saveBackup:async()=>'/test/backup'});
  assert.equal((await runNextCleanup(d,{root,purge:async scope=>{assert.match(scope.prefix,/^raw\//);}})).status,'DONE');
  assert.ok(d.prepare('SELECT id FROM processing_jobs WHERE id=?').get(second));assert.equal(d.prepare('SELECT value FROM rawdata').get().value,'preserve');
  await assert.rejects(preparedProcessedQuery(d,{...args,dataKind:'raw',snapshot:query.snapshot}),e=>e.status===409);
 }finally{d.close();for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;if(!resolve(root).startsWith(base+sep))throw new Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});}
});
test('raw and processed cleanup scopes remain separate and multi-device filters cannot broaden silently',async()=>{
 const d=fixture();try{
  const source=cal.saveCalibrationSource(d,{name:'Fixture',url:'https://docs.google.com/spreadsheets/d/test/edit?gid=0'},'admin');
  await cal.syncCalibrationSource(d,source,'admin',async()=>'aslung_id,PM,slope1,intercept1,Start_date\nAL-1,PM1,1,0,2023/1/1',{force:true});
  const result=enqueueHistorical(d,{...p,to:p.from},'admin',configuration);assert.equal(result.created,2);assert.equal(result.skipped,0);
  const root=join(base,'nonexistent'),opts={root,inventory:async()=>[]};
  const processed=await previewCleanup(d,{actor:'admin',filters:{devices:['AL-1'],kind:'processed'}},opts);assert.equal(processed.items.length,1);
  const raw=await previewCleanup(d,{actor:'admin',filters:{devices:['AL-1'],kind:'raw'}},opts);assert.equal(raw.items.length,1);assert.notEqual(raw.items[0].id,processed.items[0].id);
  for(const devices of ['AL-1',["AL-1'"]])await assert.rejects(previewCleanup(d,{actor:'admin',filters:{devices,kind:'raw'}},opts),e=>e.status===400);
  await assert.rejects(previewCleanup(d,{actor:'admin',filters:{devices:['AL-1'],device:'AL-2'}},opts),e=>e.status===400);
 }finally{d.close();}
});
