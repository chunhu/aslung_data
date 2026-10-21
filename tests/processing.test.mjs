import * as exportNames from '../lib/export-name.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as permissions from '../lib/permissions.mjs';
import {rawProcessingRows,discoverProcessingData} from '../lib/processing-raw.mjs';
import * as globalProcessing from '../lib/global-processing.mjs';
import {selectProcessedPieces,processedDataResponse} from '../lib/processed-query.mjs';
import * as zipExports from '../lib/csv-zip.mjs';
import JSZip from 'jszip';
import {processMeasurements,processingRecipe} from '../lib/measurement-processing.mjs';
import * as jobs from '../lib/processing-jobs.mjs';
import * as cal from '../lib/calibration.mjs';
const recipe=processingRecipe(0);
const sample=(i,extra={})=>({id:i,aslung_id:'AL-1',timestamp:new Date(Date.UTC(2024,0,1,0,0,i)).toISOString(),PM1_G3:8,'PM2.5_G3':10,PM10_G3:15,PM1_GSA:9,'PM2.5_GSA':11,PM10_GSA:16,temperature:23,rh:55,co2:400,...extra});
const factors=['PM1_G3','PM2.5_G3','PM10_G3','PM1_GSA','PM2.5_GSA','PM10_GSA'].map((channel,i)=>({id:i+1,version_id:7,aslung_id:'AL-1',channel,start:'2023-01-01T00:00:00.000Z',end:null,a1:1,b1:0,breakpoint:null,a2:null,b2:null}));
const middle=(extra={},r=recipe,f=factors)=>processMeasurements(Array.from({length:101},(_,i)=>sample(i,i===50?extra:{})),f,r)[50];

test('numeric strings produce the same six-rule results as numbers while preserving raw inputs',()=>{
  const channels=['PM1_G3','PM2.5_G3','PM10_G3','PM1_GSA','PM2.5_GSA','PM10_GSA','temperature','rh','co2'];
  const rows=Array.from({length:101},(_,i)=>sample(i,i===50?{PM1_G3:60,'PM2.5_G3':58,PM10_G3:62,temperature:0.5}:{}));
  const strings=rows.map(row=>({...row,...Object.fromEntries(channels.map(c=>[c,` ${row[c]} `]))}));
  const snapshot=JSON.stringify(strings),expected=processMeasurements(rows,factors,recipe),actual=processMeasurements(strings,factors,recipe);
  actual.forEach((row,i)=>{
    for(const c of channels){assert.equal(row[c],strings[i][c]);assert.equal(row[c+'_clean'],expected[i][c+'_clean']);}
    const derived=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!channels.includes(key)));
    assert.deepEqual(derived(row),derived(expected[i]));
  });
  assert.equal(JSON.stringify(strings),snapshot);
  assert.equal(actual[49].PM1_G3_final,8);assert.ok(actual[50]._quality.PM1_G3.includes('PM_NEAR_EQUAL_HIGH'));
  assert.equal(middle({PM1_G3:'8e0',rh:'.55e2'}).rh_clean,55);
  const legacy=processMeasurements(strings,factors,{...recipe,version:'six-rules-1'});
  assert.equal(legacy[49].PM1_G3_clean,null);assert.ok(legacy[49]._quality.PM1_G3.includes('INVALID_RAW'));
});

test('invalid measurement inputs stay excluded rather than being coerced into readings',()=>{
  for(const value of ['', ' ', '0x10', '12mg', 'NaN', 'Infinity', '1e999', null,undefined,true,[],{},NaN,Infinity]){
    const r=middle({PM1_G3:value,temperature:value});
    assert.equal(r.PM1_G3_clean,null);assert.equal(r.temperature_clean,null);
    assert.ok(r._quality.PM1_G3.includes('INVALID_RAW'));assert.ok(r._quality.temperature.includes('INVALID_RAW'));
  }
});
test('six rules preserve raw values, keep per-channel lower exclusions, and do not mix sensors',()=>{
  let r=middle({PM1_G3:0.5,temperature:-2,rh:0,co2:0});
  assert.equal(r.PM1_G3,0.5);assert.equal(r.PM1_G3_clean,null);assert.equal(r['PM2.5_G3_clean'],10);assert.equal(r.PM1_GSA_final,9);
  for(const k of ['temperature','rh','co2'])assert.equal(r[k+'_clean'],null);
  r=middle({PM1_G3:51,'PM2.5_G3':51,PM10_G3:51});
  for(const k of ['PM1_G3','PM2.5_G3','PM10_G3']){assert.equal(r[k+'_final'],null);assert.ok(r._quality[k].includes('PM_EQUAL_HIGH'));}
  r=middle({PM1_G3:1,temperature:1,rh:1,co2:1});assert.equal(r.PM1_G3_clean,1);assert.equal(r.temperature_clean,1);
});
test('ghost peak requires both directions to reject and propagates rejection to all three PM channels',()=>{
  const r=middle({'PM2.5_G3':100});
  assert.equal(r['PM2.5_G3_clean'],null);assert.equal(r.PM1_G3_clean,null);assert.equal(r.PM10_G3_clean,null);assert.equal(r.PM1_GSA_clean,9);
  const series=Array.from({length:101},(_,i)=>sample(i,{'PM2.5_G3':i<50?10:100}));
  assert.equal(processMeasurements(series,factors,recipe)[50]['PM2.5_G3_clean'],100); // backward side retains a sustained increase
});
test('Ghost Peak matches the uploaded Python implementation on the saved 240-sample reference',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/ghost-python.json',import.meta.url),'utf8'));
  const output=processMeasurements(fixture.pm25.map((value,i)=>sample(i,{'PM2.5_G3':value,PM10_G3:20})),factors,recipe);
  assert.deepEqual(output.map(r=>r['PM2.5_G3_clean']),fixture.expected);
  const strings=processMeasurements(fixture.pm25.map((value,i)=>sample(i,{'PM2.5_G3':value===null?null:String(value),PM10_G3:'20'})),factors,recipe);
  assert.deepEqual(strings.map(r=>r['PM2.5_G3_clean']),fixture.expected);
});
test('Python breakpoint equality uses segment two, negatives become null, PM1 capped, sixth rule uses originals',()=>{
  const custom=factors.map(f=>({...f,...(f.channel==='PM1_G3'?{a1:2,b1:0,breakpoint:8,a2:3,b2:0}:{})}));
  let r=middle({},recipe,custom);assert.equal(r.PM1_G3_calibrated,24);assert.equal(r.PM1_G3_final,10);assert.ok(r._quality.PM1_G3.includes('PM1_CAPPED_TO_PM25'));
  r=middle({},recipe,factors.map(f=>({...f,b1:-50})));assert.equal(r.PM1_G3_calibrated,null);assert.ok(r._quality.PM1_G3.includes('NEGATIVE_CALIBRATED'));
  r=middle({PM1_G3:60,'PM2.5_G3':58,PM10_G3:62});assert.equal(r.PM1_G3_final,null);assert.equal(r['PM2.5_G3_final'],null);assert.equal(r.PM10_G3_final,null);assert.ok(r._quality.PM1_G3.includes('PM_NEAR_EQUAL_HIGH'));
  r=middle({PM1_G3:60,'PM2.5_G3':55,PM10_G3:64},processingRecipe(1/3+0.000001));assert.equal(r.PM10_G3_final,null);
  r=middle({},recipe,[]);assert.equal(r.PM1_G3_final,null);assert.ok(r._quality.PM1_G3.includes('NO_FACTOR'));
  assert.equal(processingRecipe().upLimit,3);
  for(const value of [null,-1,NaN,'1'])assert.throws(()=>processingRecipe(value));
});
test('bounded blocks equal whole-series processing, including two sides of every chunk boundary',async()=>{
  const rows=Array.from({length:6200},(_,i)=>sample(i,{'PM2.5_G3':i%37===0?150:10+i%3}));
  const job={factors:JSON.stringify(factors),recipe:JSON.stringify(recipe),start:sample(25).timestamp,end:sample(6175).timestamp};
  const actual=[];for await(const block of jobs.processedBlocks(rows,job))actual.push(...block);
  const expected=processMeasurements(rows,factors,recipe).slice(25,6175);
  assert.equal(actual.length,6150);
  actual.forEach((r,i)=>{const {_background_status,...rest}=r;assert.equal(_background_status,'COMPLETE');assert.deepEqual(rest,expected[i]);});
});
test('MySQL worker reads bounded keyset pages and real context without writing raw data',async()=>{
  let calls=0;const pool={query:async({sql,values,timeout})=>{
    assert.match(sql,/^SELECT /);assert.ok(!sql.includes('AL-1'));assert.equal(values[0],'AL-1');assert.equal(timeout,60000);
    calls++;
    assert.match(sql,/SELECT rawdata\.\*/);assert.match(sql,/ch7 AS battery/);assert.match(sql,/ch37 AS `Num_10_GSA`/);
    const raw=(i)=>({id:i,aslung_id:'AL-1',time:new Date(Date.UTC(2024,0,1,0,0,i)),PM1_G3:8,battery:'4.1',ch15:'extra-channel',gps:'25,121'});
    if(calls===1){assert.match(sql,/LIMIT 25/);return [[raw(-1),raw(-2)]];}
    if(calls===2){assert.match(sql,/LIMIT 2000/);return [Array.from({length:2000},(_,i)=>raw(i))];}
    if(calls===3){assert.match(sql,/time>\? OR \(time=\? AND id>\?\)/);assert.equal(values.at(-1),1999);return [[raw(2000)]];}
    assert.match(sql,/time>=\?.*LIMIT 25/);return [[raw(2100)]];
  }};
  const out=[];for await(const r of rawProcessingRows(pool,{device:'AL-1',start:sample(0).timestamp,end:sample(2100).timestamp}))out.push(r);
  assert.equal(calls,4);assert.equal(out.length,2004);assert.equal(out[0].id,-2);assert.equal(out[1].id,-1);assert.equal(out.at(-1).id,2100);assert.equal(out[2].timestamp,sample(0).timestamp);
  assert.equal(out[2].ch15,'extra-channel');assert.equal(out[2].battery,'4.1');
  const processed=processMeasurements(out.slice(0,5),factors,recipe);
  assert.equal(processed[2].gps,'25,121');assert.equal(processed[2].ch15,'extra-channel');
});
async function fixture(){
  const d=new DatabaseSync(':memory:');d.exec("CREATE TABLE devices(id TEXT PRIMARY KEY); INSERT INTO devices VALUES('AL-1')");cal.ensureCalibrationSchema(d);jobs.ensureProcessingSchema(d);
  const source=cal.saveCalibrationSource(d,{name:'Fixture',url:'https://docs.google.com/spreadsheets/d/test/edit?gid=0'},'admin');
  await cal.syncCalibrationSource(d,source,'admin',async()=>'aslung_id,PM,slope1,intercept1,Start_date\nAL-1,PM1,1,0,2023/1/1\nAL-1,PM2.5,1,0,2023/1/1\nAL-1,PM10,1,0,2023/1/1',{force:true});
  return d;
}
const request={device:'AL-1',start:sample(25).timestamp,end:sample(75).timestamp,upLimit:0,actor:'admin'};
test('queue pins coefficients and recipe, reuses identical requests, and supports explicit new revisions',async()=>{
  const d=await fixture();try{
    const id=jobs.enqueueProcessing(d,request);assert.equal(jobs.enqueueProcessing(d,request),id);
    const defaultId=jobs.enqueueProcessing(d,{...request,upLimit:undefined});
    assert.equal(JSON.parse(d.prepare('SELECT recipe FROM processing_jobs WHERE id=?').get(defaultId).recipe).upLimit,3);
    jobs.saveProcessingSchedule(d,{device:'AL-1',enabled:false,actor:'admin'});
    assert.equal(d.prepare('SELECT up_limit FROM processing_schedules').get().up_limit,3);
    d.prepare('DELETE FROM processing_jobs WHERE id=?').run(defaultId);
    assert.notEqual(jobs.enqueueProcessing(d,{...request,refresh:'revision'}),id);
    const job=jobs.claimProcessing(d);assert.equal(job.status,'RUNNING');assert.equal(job.attempts,1);
    assert.equal(JSON.parse(job.factors)[0].a1,1);d.prepare('UPDATE calibration_records SET a1=10').run();assert.equal(JSON.parse(job.factors)[0].a1,1);
    assert.throws(()=>jobs.enqueueProcessing(d,{...request,upLimit:null}));assert.throws(()=>jobs.enqueueProcessing(d,{...request,device:'NONE'}));
    assert.throws(()=>jobs.enqueueProcessing(d,{...request,end:'2025-01-01T00:00:00Z'}));
    const other=jobs.claimProcessing(d);assert.notEqual(other.id,job.id);assert.equal(jobs.claimProcessing(d),undefined);
    const reclaimed=jobs.claimProcessing(d,Date.now()+130000);assert.equal(reclaimed.id,job.id);assert.equal(reclaimed.attempts,2);
  }finally{d.close();}
});
test('worker atomically publishes compressed output, failed runs retain no completed result, and retry works',async()=>{
  const d=await fixture(),root=await mkdtemp(join(process.cwd(),'.tools','processing-test-'));
  try{
    const id=jobs.enqueueProcessing(d,request),job=jobs.claimProcessing(d),rows=Array.from({length:101},(_,i)=>sample(i,{battery:'4.1',ch15:'extra-channel',gps:'25,121'}));
    assert.equal(await jobs.runProcessing(d,job,rows,root),50);
    const stored=d.prepare('SELECT * FROM processing_jobs WHERE id=?').get(id);assert.equal(stored.status,'COMPLETED');assert.equal(stored.rows_done,50);
    const result=[];for await(const row of jobs.readProcessingResult(stored,root))result.push(row);
    assert.equal(result.length,50);assert.equal(result[0].timestamp,request.start);assert.equal(result[0]._background_status,'COMPLETE');
    assert.equal(result[0].battery,'4.1');assert.equal(result[0].ch15,'extra-channel');assert.equal(result[0].gps,'25,121');
    jobs.enqueueProcessing(d,{...request,refresh:'fail'});const failed=jobs.claimProcessing(d);
    async function* broken(){yield sample(0);throw new Error('simulated connection failure');}
    await assert.rejects(()=>jobs.runProcessing(d,failed,broken(),root),/simulated/);
    assert.equal(d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(failed.id).status,'FAILED');
    assert.deepEqual(await readdir(root),[id+'.jsonl.gz']);
    jobs.retryProcessing(d,failed.id);assert.equal(jobs.claimProcessing(d).id,failed.id);
    assert.throws(()=>jobs.resultPath(root,'../../unsafe'));
  }finally{d.close();await rm(root,{recursive:true,force:true});}
});
test('daily schedule is opt-in, runs after Taipei 03:00, queues rolling three days and deduplicates',async()=>{
  const d=await fixture();try{
    jobs.scheduleProcessing(d,new Date('2024-01-05T00:00:00Z'));assert.equal(d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n,0);
    jobs.saveProcessingSchedule(d,{device:'AL-1',upLimit:0,enabled:true,actor:'admin'});
    jobs.scheduleProcessing(d,new Date('2024-01-04T18:00:00Z'));assert.equal(d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n,0);
    jobs.scheduleProcessing(d,new Date('2024-01-04T19:00:00Z'));assert.equal(d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n,3);
    jobs.scheduleProcessing(d,new Date('2024-01-05T02:00:00Z'));assert.equal(d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n,3);
    jobs.saveProcessingSchedule(d,{device:'AL-1',upLimit:0,enabled:false,actor:'admin'});
    jobs.scheduleProcessing(d,new Date('2024-01-06T02:00:00Z'));assert.equal(d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n,3);
  }finally{d.close();}
});
test('processing API protects writes, enforces result data permission and viewer download restrictions',async()=>{
  const d=await fixture();let member={role:'admin',email:'admin'},allow=true,guard=true,checked=0;
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const server={AppError,identity:async()=>member,writeGuard:()=>{if(!guard)throw new AppError(403,'origin');},
    fail:e=>Response.json({error:e.message},{status:e.status||500}),required:(v)=>{if(!v||typeof v!=='string')throw new AppError(400,'required');return v;},
    instant:v=>new Date(v).toISOString(),permitted:async()=>{checked++;if(!allow)throw new AppError(403,'denied');}};
  const deps={'@/lib/export-name.mjs':exportNames,'@/lib/server':server,'@/lib/permissions.mjs':permissions,'@/lib/store.mjs':{getConnection:()=>d},'@/lib/processing-jobs.mjs':jobs,'@/lib/global-processing.mjs':globalProcessing,'@/lib/csv-zip.mjs':zipExports};
  const code=ts.transpileModule(readFileSync(new URL('../app/api/processing/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(key=>{assert.ok(key in deps);return deps[key];},module,module.exports);
  const api=module.exports,get=q=>api.GET(new Request('http://localhost/api/processing'+q)),post=p=>api.POST(new Request('http://localhost/api/processing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}));
  const root=await mkdtemp(join(process.cwd(),'.tools','processing-api-')),previous=process.env.CALIBRATION_RESULT_DIR;process.env.CALIBRATION_RESULT_DIR=root;
  try{
    member={role:'member',email:'m'};assert.equal((await get('')).status,403);assert.equal((await post({action:'enqueue',...request})).status,403);
    member={role:'admin',email:'admin'};guard=false;assert.equal((await post({action:'enqueue',...request})).status,403);guard=true;
    assert.equal((await post(null)).status,400);
    assert.equal((await post({action:'global',enabled:true,upLimit:3})).status,200);
    assert.equal(globalProcessing.globalProcessingSettings(d).enabled,1);
    assert.equal((await post({action:'global',enabled:'yes'})).status,400);
    assert.equal((await post({action:'enqueue',...request,upLimit:null})).status,400);
    const res=await post({action:'enqueue',...request});assert.equal(res.status,200);const {ids}=await res.json();assert.equal(ids.length,1);
    assert.equal((await get('?id='+ids[0])).status,409);
    const job=jobs.claimProcessing(d);await jobs.runProcessing(d,job,Array.from({length:101},(_,i)=>sample(i)),root);
    member={role:'member',email:'m'};allow=false;assert.equal((await get('?id='+job.id)).status,403);allow=true;
    member={role:'viewer',email:'v'};assert.equal((await get('?id='+job.id+'&download=1')).status,403);
    const preview=await get('?id='+job.id);assert.equal(preview.status,200);assert.equal((await preview.json()).data.length,50);
    member={role:'member',email:'m'};const download=await get('?id='+job.id+'&download=1');assert.equal(download.status,200);assert.match(download.headers.get('Content-Type'),/zip/);
    const zip=await JSZip.loadAsync(await download.arrayBuffer(),{checkCRC32:true});assert.match(await zip.file('AL-1_20240101.csv').async('string'),/PM1_G3_final/);assert.ok(checked>=5);
    // Revocation is checked again for every new request, even when a file already exists.
    allow=false;assert.equal((await get('?id='+job.id+'&download=1')).status,403);
  }finally{d.close();if(previous===undefined)delete process.env.CALIBRATION_RESULT_DIR;else process.env.CALIBRATION_RESULT_DIR=previous;await rm(root,{recursive:true,force:true});}
});
test('history filters and pagination expose older jobs and metadata details without reading results',async()=>{
  const d=await fixture();let role='admin';
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const deps={'@/lib/server':{AppError,identity:async()=>({role}),permitted:async()=>{},required:v=>v,fail:e=>Response.json({error:e.message},{status:e.status||500})},
    '@/lib/permissions.mjs':permissions,'@/lib/store.mjs':{getConnection:()=>d},'@/lib/processing-jobs.mjs':jobs,
    '@/lib/global-processing.mjs':globalProcessing,'@/lib/csv-zip.mjs':zipExports,'@/lib/export-name.mjs':exportNames};
  const code=ts.transpileModule(readFileSync(new URL('../app/api/processing/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(key=>{assert.ok(key in deps,key);return deps[key];},module,module.exports);
  const get=q=>module.exports.GET(new Request('http://test/api/processing?'+q));
  try{
    const ids=[];
    for(let i=0;i<105;i++){
      const start=new Date(Date.UTC(2024,0,i+1,16)).toISOString(),end=new Date(Date.parse(start)+86400000).toISOString();
      const id=jobs.enqueueProcessing(d,{...request,start,end});ids.push(id);
      d.prepare('UPDATE processing_jobs SET status=?,created_at=? WHERE id=?').run(['QUEUED','RUNNING','COMPLETED','FAILED'][i%4],start,id);
    }
    const first=await (await get('')).json();assert.equal(first.pagination.total,105);assert.equal(first.jobs.length,20);assert.equal(first.pagination.pages,6);
    const last=await (await get('page=6')).json();assert.equal(last.jobs.length,5);assert.equal(last.jobs.at(-1).id,ids[0]);
    const bounded=await (await get('page=999')).json();assert.equal(bounded.pagination.page,6);
    const days=await (await get('device=al-1&from=2024-01-04&to=2024-01-05')).json();assert.equal(days.pagination.total,2);
    assert.deepEqual(new Set(days.jobs.map(j=>j.id)),new Set([ids[2],ids[3]]));
    const completed=await (await get('from=2024-01-04&to=2024-01-05&status=COMPLETED')).json();assert.equal(completed.jobs[0].id,ids[2]);assert.equal(completed.pagination.total,1);
    assert.equal((await (await get('device=AL-OTHER')).json()).pagination.total,0);
    // These completed fixtures have no physical file: details must stay metadata-only.
    const details=await get('id='+ids[2]+'&detail=1');assert.equal(details.status,200);
    const body=await details.json();assert.equal(body.job.status,'COMPLETED');assert.equal(body.job.recipe.rawSchema,'all-fields-1');assert.equal(body.data,undefined);assert.equal(body.job.result_bucket,undefined);
    assert.equal((await get('id='+ids[0]+'&detail=1')).status,200);
    assert.equal((await get('id='+ids[0])).status,409);
    for(const invalid of ['page=0','page=1.1','page_size=101','status=WRONG','from=2024-02-30','from=2024-01-04&to=2024-01-03',"device=AL-1%27"])
      assert.equal((await get(invalid)).status,400,invalid);
    role='member';assert.equal((await get('')).status,403);assert.equal((await get('id='+ids[2]+'&detail=1')).status,403);
  }finally{d.close();}
});

test('global scheduling automatically includes measured devices with factors, deduplicates and processes yesterday without requiring new arrivals today',async()=>{
  const d=await fixture();let discoveries=0;
  const data=[{device:'AL-1',day:'2024-01-03',last_id:'100'},{device:'AL-1',day:'2024-01-04',last_id:'150'},{device:'AL-1',day:'2024-01-05',last_id:'200'}];
  const discover=async(ids)=>{discoveries++;assert.deepEqual(ids,['AL-1']);return data;};
  try{
    const now=new Date('2024-01-04T19:00:00Z');
    await globalProcessing.scheduleGlobalProcessing(d,discover,now);assert.equal(discoveries,0);
    globalProcessing.saveGlobalProcessing(d,{enabled:true,actor:'admin'});
    await globalProcessing.scheduleGlobalProcessing(d,discover,new Date('2024-01-04T18:00:00Z'));assert.equal(discoveries,0);
    const first=await globalProcessing.scheduleGlobalProcessing(d,discover,now);assert.equal(first.jobs,2);assert.equal(first.changedDevices,1);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n,2);
    await globalProcessing.scheduleGlobalProcessing(d,discover,now);assert.equal(discoveries,1);
    const next=await globalProcessing.scheduleGlobalProcessing(d,discover,new Date('2024-01-05T19:00:00Z'));assert.equal(next.jobs,1);
    const unchanged=await globalProcessing.scheduleGlobalProcessing(d,discover,new Date('2024-01-06T19:00:00Z'));assert.equal(unchanged.jobs,0);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n,3);
    data[2].last_id='250';
    const late=await globalProcessing.scheduleGlobalProcessing(d,discover,new Date('2024-01-07T19:00:00Z'));assert.equal(late.jobs,1);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n,4);
    globalProcessing.saveGlobalProcessing(d,{enabled:true,upLimit:4,actor:'admin'});
    const changed=await globalProcessing.scheduleGlobalProcessing(d,discover,new Date('2024-01-07T19:00:00Z'));assert.equal(changed.jobs,1);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n,5);
  }finally{d.close();}
});
test('global scheduling respects explicit device schedules, source periods, disables and failed discovery retries',async()=>{
  const d=await fixture();try{
    globalProcessing.saveGlobalProcessing(d,{enabled:true,actor:'admin'});
    jobs.saveProcessingSchedule(d,{device:'AL-1',enabled:true,actor:'admin'});
    const now=new Date('2024-01-04T19:00:00Z');
    const skipped=await globalProcessing.scheduleGlobalProcessing(d,()=>{throw new Error('manual devices should not be scanned');},now);assert.equal(skipped.candidateDevices,0);
    jobs.saveProcessingSchedule(d,{device:'AL-1',enabled:false,actor:'admin'});globalProcessing.saveGlobalProcessing(d,{enabled:true,actor:'admin'});
    const failed=await globalProcessing.scheduleGlobalProcessing(d,async()=>{throw new Error('MySQL unavailable');},now);
    assert.match(failed.error,/MySQL/);assert.match(globalProcessing.globalProcessingSettings(d).last_error,/MySQL/);
    let called=false;await globalProcessing.scheduleGlobalProcessing(d,async()=>{called=true;return [];},now);assert.equal(called,false);
    const old=await globalProcessing.scheduleGlobalProcessing(d,async()=>[{device:'AL-1',day:'2022-01-01',last_id:'1'}],new Date(now.getTime()+300001));assert.equal(old.jobs,0);
    globalProcessing.saveGlobalProcessing(d,{enabled:true,actor:'admin'});
    await globalProcessing.scheduleGlobalProcessing(d,async()=>{globalProcessing.saveGlobalProcessing(d,{enabled:false,actor:'admin'});return [{device:'AL-1',day:'2024-01-04',last_id:'10'}];},now);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n,0);
    assert.equal(globalProcessing.globalProcessingSettings(d).enabled,0);
  }finally{d.close();}
});
test('global MySQL discovery batches eligible IDs and uses only bounded, parameterized SELECT summaries',async()=>{
  let count=0,beats=0;const ids=Array.from({length:205},(_,i)=>'AL-'+i);
  const rows=await discoverProcessingData({query:async({sql,values,timeout})=>{
    count++;assert.match(sql,/^SELECT /);assert.match(sql,/GROUP BY uid,day/);assert.match(sql,/CAST\(MAX\(id\) AS CHAR\)/);
    assert.ok(values.length<=102);assert.equal(timeout,60000);assert.ok(!sql.includes('AL-'));
    return [[{device:values[0],day:'2024-01-04',last_id:'9007199254740993'}]];
  }},ids,'2024-01-01T16:00:00Z','2024-01-04T19:00:00Z',()=>beats++);
  assert.equal(count,3);assert.equal(rows.length,3);assert.equal(beats,6);
});
test('completed-result lookup splits overlaps by latest completed version and reports all missing coverage',()=>{
  const older={id:'old',start:sample(0).timestamp,end:sample(100).timestamp,finished_at:'2024-01-02',created_at:'2024-01-01'};
  const newer={...older,id:'new',start:sample(25).timestamp,end:sample(75).timestamp,finished_at:'2024-01-03'};
  assert.deepEqual(selectProcessedPieces([older,newer],[{start:sample(0).timestamp,end:sample(99).timestamp}]).map(p=>p.id),['old','new','old']);
  assert.throws(()=>selectProcessedPieces([newer],[{start:sample(0).timestamp,end:sample(99).timestamp}]),e=>e.status===409&&e.message.includes('尚無完整'));
});
test('data query reads stored results without raw queries, pins versions, filters intervals and streams CSV/JSON',async()=>{
  const d=await fixture(),root=await mkdtemp(join(process.cwd(),'.tools','processed-query-'));
  try{
    jobs.enqueueProcessing(d,request);const job=jobs.claimProcessing(d);
    await jobs.runProcessing(d,job,Array.from({length:101},(_,i)=>sample(i)),root);
    let authorized=0;
    const options={id:'AL-1',start:sample(30).timestamp,end:sample(60).timestamp,ranges:[{start:sample(30).timestamp,end:sample(60).timestamp}],segmentId:'1',root,authorize:async()=>{authorized++;}};
    const res=await processedDataResponse(d,{...options,url:new URL('http://localhost/api/data?calibration=processed')});
    const initial=await res.json();assert.equal(initial.data.length,31);assert.equal(initial.data[0].timestamp,options.start);assert.equal(initial.data.at(-1).timestamp,options.end);assert.equal(initial.data[0]._processing_job_id,job.id);
    jobs.enqueueProcessing(d,{...request,start:sample(45).timestamp,end:sample(55).timestamp,refresh:'newer'});const newer=jobs.claimProcessing(d);
    await jobs.runProcessing(d,newer,Array.from({length:101},(_,i)=>sample(i,{PM1_G3:9,battery:'4.1',ch15:'extra-channel'})),root);
    const pinned=new URL('http://localhost/api/data?download=1&format=json');pinned.searchParams.set('calibration_snapshot',initial.calibration_snapshot);
    const oldZip=await JSZip.loadAsync(await (await processedDataResponse(d,{...options,url:pinned})).arrayBuffer(),{checkCRC32:true});
    const old=JSON.parse(await oldZip.file('AL-1_20240101.json').async('string'));assert.equal(old.data[0].PM1_G3,8);assert.equal(old.data[0]._processing_job_id,job.id);
    const csvZip=await JSZip.loadAsync(await (await processedDataResponse(d,{...options,url:new URL('http://localhost/api/data?download=1&format=csv')})).arrayBuffer(),{checkCRC32:true});
    const csv=await csvZip.file('AL-1_20240101.csv').async('string');assert.match(csv,/_processing_up_limit/);assert.match(csv,new RegExp(newer.id));
    assert.match(csv.split('\r\n')[0],/battery,ch15/);assert.match(csv,/4.1,extra-channel/);
    const zipped=await processedDataResponse(d,{...options,url:new URL('http://localhost/api/data?download=1&format=csvzip')});
    const archive=await JSZip.loadAsync(await zipped.arrayBuffer(),{checkCRC32:true});
    assert.match(await archive.file('AL-1_20240101.csv').async('string'),new RegExp(newer.id));
    const disjoint=await (await processedDataResponse(d,{...options,ranges:[{start:sample(30).timestamp,end:sample(32).timestamp},{start:sample(58).timestamp,end:sample(60).timestamp}],url:new URL('http://localhost/api/data')})).json();assert.equal(disjoint.data.length,6);
    await assert.rejects(()=>processedDataResponse(d,{...options,url:pinned,authorize:async()=>{throw Object.assign(new Error('permission revoked'),{status:403});}}),e=>e.status===403);
    await assert.rejects(()=>processedDataResponse(d,{...options,end:sample(90).timestamp,ranges:[{start:options.start,end:sample(90).timestamp}],url:pinned}),e=>e.status===409);
    await assert.rejects(()=>processedDataResponse(d,{...options,ranges:[{start:sample(0).timestamp,end:sample(90).timestamp}],url:new URL('http://localhost/api/data')}),e=>e.status===409);
    assert.ok(authorized>=4);
  }finally{d.close();await rm(root,{recursive:true,force:true});}
});
test('measurement API exposes completed results, paginates a pinned file and retains export and context authorization',async()=>{
  const d=await fixture(),root=await mkdtemp(join(process.cwd(),'.tools','processed-api-')),previous=process.env.CALIBRATION_RESULT_DIR;
  process.env.CALIBRATION_RESULT_DIR=root;let me={role:'admin',email:'admin'},allow=true,permissionChecks=0;
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const server={AppError,identity:async()=>me,fail:e=>Response.json({error:e.message},{status:e.status||500}),required:v=>v,instant:v=>new Date(v).toISOString(),authorizedDataRanges:async(m,id,start,end)=>[{start,end}],permitted:async()=>{permissionChecks++;if(!allow)throw new AppError(403,'denied');}};
  const deps={'@/lib/export-name.mjs':exportNames,'@/lib/server':server,'@/lib/permissions.mjs':permissions,'@/lib/download-segments.mjs':{},'@/lib/data':{fetchPage:()=>{throw new Error('must not query MySQL');}},'@/lib/processed-query.mjs':{processedDataResponse},'@/lib/store.mjs':{getConnection:()=>d}};
  const code=ts.transpileModule(readFileSync(new URL('../app/api/data/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(key=>{assert.ok(key in deps,key);return deps[key];},module,module.exports);
  try{
    jobs.enqueueProcessing(d,{...request,start:sample(0).timestamp,end:sample(1250).timestamp});const job=jobs.claimProcessing(d);
    await jobs.runProcessing(d,job,Array.from({length:1300},(_,i)=>sample(i)),root);
    const url=new URL('http://localhost/api/data');for(const [key,value] of Object.entries({aslung_id:'AL-1',start:sample(25).timestamp,end:sample(1200).timestamp,calibration:'processed'}))url.searchParams.set(key,value);
    const call=()=>module.exports.GET(new Request(url));
    const first=await (await call()).json();assert.equal(first.data.length,1000);assert.equal(first.has_more,true);
    url.searchParams.set('calibration_snapshot',first.calibration_snapshot);url.searchParams.set('cursor',first.next_cursor);
    const second=await (await call()).json();assert.equal(second.data.length,176);assert.equal(second.has_more,false);assert.equal(second.data[0].timestamp,sample(1025).timestamp);
    me={role:'viewer',email:'v'};url.searchParams.set('download','1');assert.equal((await call()).status,403);
    url.searchParams.delete('download');me={role:'member',email:'m'};assert.equal((await call()).status,200);assert.ok(permissionChecks>=4);
    allow=false;assert.equal((await call()).status,403);
  }finally{d.close();if(previous===undefined)delete process.env.CALIBRATION_RESULT_DIR;else process.env.CALIBRATION_RESULT_DIR=previous;await rm(root,{recursive:true,force:true});}
});
