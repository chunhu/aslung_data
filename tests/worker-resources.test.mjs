import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workerResourceOptions,workerCycle,workerLoop,waitForWorker} from '../lib/worker-resources.mjs';
import {rawProcessingRows,discoverProcessingData} from '../lib/processing-raw.mjs';

function fixture(){
  const calls=[];
  return {calls,tasks:{
    cleanupHobo:async()=>calls.push('cleanupHobo'),archiveHobo:async()=>{calls.push('archiveHobo');return true;},
    syncHobo:async()=>calls.push('syncHobo'),hoboError:()=>calls.push('hoboError'),cleanupProcessing:async()=>calls.push('cleanupProcessing'),
    syncSources:async limit=>calls.push(['syncSources',limit]),schedule:async()=>calls.push('schedule'),upload:async()=>calls.push('upload'),
    processNext:async()=>{calls.push('processNext');return true;},
  }};
}
test('worker defaults bound work; invalid configuration is rejected before startup',()=>{
  const options=workerResourceOptions({});assert.equal(options.archiveDays,1);assert.equal(options.calibrationSources,1);assert.equal(options.batchSize,1000);
  for(const [key,value] of Object.entries({WORKER_BUSY_DELAY_MS:'0',WORKER_IDLE_DELAY_MS:'NaN',WORKER_HOBO_ARCHIVE_DAYS:'-1',WORKER_CALIBRATION_SOURCES:'11',WORKER_RAW_BATCH_SIZE:'2001',WORKER_BATCH_PAUSE_MS:'1.5'}))assert.throws(()=>workerResourceOptions({[key]:value}),new RegExp(key));
  assert.equal(workerResourceOptions({WORKER_BATCH_PAUSE_MS:'0'}).batchPauseMs,0);
});
test('each round bounds archival and coefficient sources without starving processing',async()=>{
  const {tasks,calls}=fixture();const options=workerResourceOptions({WORKER_HOBO_ARCHIVE_DAYS:'2',WORKER_CALIBRATION_SOURCES:'3'});
  assert.equal(await workerCycle(tasks,options),true);
  assert.deepEqual(calls,['cleanupHobo','archiveHobo','archiveHobo','syncHobo','cleanupProcessing',['syncSources',3],'schedule','upload','processNext']);
});
test('no pending archive stops that stage early, and HOBO failures retain processing progress',async()=>{
  const {tasks,calls}=fixture();tasks.archiveHobo=async()=>{calls.push('archiveHobo');return null;};
  await workerCycle(tasks,workerResourceOptions({WORKER_HOBO_ARCHIVE_DAYS:'10'}));assert.equal(calls.filter(value=>value==='archiveHobo').length,1);
  calls.length=0;tasks.archiveHobo=async()=>{throw new Error('S3 unavailable');};await workerCycle(tasks,workerResourceOptions({}));
  assert.ok(calls.includes('hoboError'));assert.ok(calls.includes('processNext'));
});
test('busy queues and idle queues both pause between rounds; once does not sleep',async()=>{
  for(const busy of [true,false]){
    const {tasks}=fixture(),controller=new AbortController(),delays=[];let jobs=0;
    tasks.processNext=async()=>{jobs++;return busy;};
    const options=workerResourceOptions({});
    await workerLoop(tasks,options,{signal:controller.signal,wait:async ms=>{delays.push(ms);if(delays.length===3)controller.abort();}});
    assert.equal(jobs,3);assert.deepEqual(delays,Array(3).fill(busy?2000:5000));
    await workerLoop(tasks,options,{once:true,wait:()=>assert.fail('once must not wait')});assert.equal(jobs,4);
  }
});
test('shutdown finishes the current stage and claims no further work',async()=>{
  const {tasks,calls}=fixture(),controller=new AbortController();
  tasks.syncHobo=async()=>{calls.push('syncHobo');controller.abort();};
  await workerLoop(tasks,workerResourceOptions({}),{signal:controller.signal});assert.ok(!calls.includes('processNext'));
  const next=fixture(),other=new AbortController();let completed=false;
  next.tasks.processNext=async()=>{other.abort();await new Promise(resolve=>setImmediate(resolve));completed=true;return true;};
  await workerLoop(next.tasks,workerResourceOptions({}),{signal:other.signal,wait:()=>assert.fail()});assert.equal(completed,true);
});
test('shutdown interrupts a long pacing wait promptly',async()=>{
  const controller=new AbortController();const waiting=waitForWorker(300000,controller.signal);
  controller.abort();await waiting;
});
test('smaller raw batches preserve keyset ordering, tie IDs and 25-sample context queries',async()=>{
  const calls=[],item=id=>({id,time:'2026-10-01 00:00:00',aslung_id:'AL-1'});
  const pool={query:async({sql,values})=>{
    calls.push({sql,values});
    if(sql.includes('ORDER BY time DESC'))return [[item(0)]];
    if(sql.includes('LIMIT 25'))return [[item(6)]];
    assert.match(sql,/LIMIT 2$/);
    if(!sql.includes('AND (time>'))return [[item(1),item(2)]];
    const id=values.at(-1);return [id===2?[item(3),item(4)]:[item(5)]];
  }};
  const rows=[];for await(const row of rawProcessingRows(pool,{device:'AL-1',start:'2026-10-01T00:00:00Z',end:'2026-10-02T00:00:00Z'},{batchSize:2,batchPauseMs:1}))rows.push(row);
  assert.deepEqual(rows.map(row=>row.id),[0,1,2,3,4,5,6]);assert.equal(calls.length,5);
  assert.deepEqual(calls[2].values.slice(-3),['2026-10-01 00:00:00','2026-10-01 00:00:00',2]);
});
test('discovery yields between device batches without changing returned summaries',async()=>{
  let calls=0;const devices=Array.from({length:205},(_,i)=>String(i));
  const rows=await discoverProcessingData({query:async({values})=>{calls++;return [values.slice(0,-2).map(device=>({device,last_id:'1'}))];}},devices,'2026-10-01','2026-10-02',()=>{},{batchPauseMs:1});
  assert.equal(calls,3);assert.deepEqual(rows.map(row=>row.device),devices);
});
