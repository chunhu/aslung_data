import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import * as batches from '../lib/historical-batches.mjs';
import * as jobs from '../lib/processing-jobs.mjs';
import * as audit from './helpers/activity-audit.mjs';
test('monthly batch endpoints require admin and same origin; creation replay and control status remain consistent',async()=>{
 const d=new DatabaseSync(':memory:');d.exec("CREATE TABLE devices(id TEXT PRIMARY KEY);INSERT INTO devices VALUES('AL-1');");let role='admin';
 class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
 const config={mode:'s3',bucket:'aslung-test-bucket',region:'ap-northeast-1'};
 const deps={'@/lib/activity-server':audit,'@/lib/server':{identity:async()=>({email:'admin@test',role}),writeGuard:r=>{if(r.headers.get('origin')!=='http://test')throw new AppError(403,'origin');},AppError,fail:e=>Response.json({error:e.message},{status:e.status||500})},'@/lib/permissions.mjs':{},'@/lib/store.mjs':{getConnection:()=>d},'@/lib/processing-jobs.mjs':jobs,'@/lib/csv-zip.mjs':{},'@/lib/export-name.mjs':{},'@/lib/global-processing.mjs':{globalProcessingSettings:()=>({enabled:0})},'@/lib/s3-storage.mjs':{storageConfiguration:()=>config},'@/lib/historical-batches.mjs':{...batches,createHistoricalBatch:(db,p,actor)=>batches.createHistoricalBatch(db,p,actor,config)}};
 const code=ts.transpileModule(readFileSync(new URL('../app/api/processing/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,m={exports:{}};new Function('require','module','exports',code)(k=>{assert.ok(k in deps,k);return deps[k];},m,m.exports);
 const post=(p,origin='http://test')=>m.exports.POST(new Request('http://test/api/processing',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(p)})),get=()=>m.exports.GET(new Request('http://test/api/processing'));
 try{
  const input={action:'historical',devices:['AL-1'],kind:'raw',from:'2025-01-01',to:'2025-12-31',requestKey:randomUUID()};
  for(const member of ['member','viewer','basic','calibration_manager']){role=member;assert.equal((await post(input)).status,403);assert.equal((await get()).status,403);assert.equal((await post({action:'historicalControl',operation:'cancel',id:randomUUID()})).status,403);}
  role='admin';assert.equal((await post(input,'https://evil.test')).status,403);const created=await post(input);assert.equal(created.status,200);const batch=await created.json();assert.equal(batch.months,12);assert.equal((await (await post(input)).json()).id,batch.id);
  const read=await (await get()).json();assert.equal(read.historical[0].id,batch.id);assert.equal(read.historical[0].status,'QUEUED');assert.equal(read.historical[0].current.total,31);
  for(const [operation,status] of [['pause','PAUSED'],['resume','RUNNING'],['cancel','CANCELLED']]){const result=await post({action:'historicalControl',id:batch.id,operation});assert.equal(result.status,200);assert.equal((await result.json()).status,status);}
  assert.equal((await post({action:'historicalControl',id:batch.id,operation:'retry'})).status,409);
  assert.equal(d.prepare('SELECT count(*) n FROM historical_batches').get().n,1);assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,0);
 }finally{d.close();}
});
