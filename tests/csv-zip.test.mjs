import {test} from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {csvChunks,csvZipResponse,jsonChunks,jsonZipResponse} from '../lib/csv-zip.mjs';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

test('server ZIP round-trips UTF-8 CSV, quotes fields and compresses repetitive measurements',async()=>{
  const rows=Array.from({length:5000},(_,i)=>({timestamp:'2026-10-19T00:00:00Z',aslung_id:'AL-1',PM1:12,description:'校正資料，測試',notes:i===0?'a,"b"\nnext':'重複文字'}));
  async function* source(){yield* rows;}
  let original='';for await(const chunk of csvChunks(source()))original+=chunk;
  const response=await csvZipResponse(csvChunks(source()),'AL-1_export');
  assert.equal(response.headers.get('Content-Type'),'application/zip');assert.match(response.headers.get('Content-Disposition'),/\.zip/);
  const buffer=await response.arrayBuffer();assert.ok(buffer.byteLength<Buffer.byteLength(original)/5);
  const zip=await JSZip.loadAsync(buffer,{checkCRC32:true});assert.deepEqual(Object.keys(zip.files),['AL-1_export.csv']);
  assert.equal(await zip.file('AL-1_export.csv').async('string'),original);
  assert.match(original,/校正資料/);assert.match(original,/"a,""b""\nnext"/);
});
test('ZIP supports empty exports, safe entry names, preflight errors and bounded CSV sizes',async()=>{
  async function* empty(){}
  const response=await csvZipResponse(csvChunks(empty()),'../../unsafe');const zip=await JSZip.loadAsync(await response.arrayBuffer(),{checkCRC32:true});
  assert.equal(await Object.values(zip.files)[0].async('string'),'\uFEFFtimestamp\r\n');assert.ok(Object.keys(zip.files).every(name=>!name.includes('/')));
  async function* broken(){throw new Error('database unavailable');}
  await assert.rejects(()=>csvZipResponse(broken(),'test'),/database unavailable/);
  async function* large(){yield '12345';yield '67890';}
  const limited=await csvZipResponse(large(),'test',{maxBytes:6});await assert.rejects(()=>limited.arrayBuffer(),/2 GiB/);
});
test('canceling a ZIP download closes its underlying CSV generator',async()=>{
  let closed=false;
  async function* source(){try{while(true){yield Buffer.alloc(65536,65);await new Promise(resolve=>setImmediate(resolve));}}finally{closed=true;}}
  const response=await csvZipResponse(source(),'cancel'),reader=response.body.getReader();await reader.read();await reader.cancel();
  for(let i=0;i<20&&!closed;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(closed,true);
});
test('CSV ZIP API exports all raw pages and rejects unauthorized downloads before reading data',async()=>{
  let role='admin',allowed=true,calls=0;
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const server={AppError,required:v=>v,instant:v=>new Date(v).toISOString(),identity:async()=>({role}),permitted:async()=>{if(!allowed)throw new AppError(403,'denied');},authorizedDataRanges:async()=>[{start:'2024-01-01T00:00:00.000Z',end:'2024-01-02T00:00:00.000Z'}],fail:e=>Response.json({error:e.message},{status:e.status||500})};
  const deps={'@/lib/server':server,'@/lib/permissions.mjs':{canExportData:m=>m.role!=='viewer'},'@/lib/download-segments.mjs':{},'@/lib/csv-zip.mjs':{csvChunks,csvZipResponse,jsonChunks,jsonZipResponse},'@/lib/data':{fetchPage:async(id,s,e,cursor)=>{calls++;return {data:[{timestamp:cursor?'2024-01-01T00:01:00.000Z':'2024-01-01T00:00:00.000Z',aslung_id:id,PM1_G3:cursor?2:1}],has_more:!cursor,next_cursor:cursor?null:'next'};}}};
  const code=ts.transpileModule(readFileSync(new URL('../app/api/data/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(key=>{assert.ok(key in deps,key);return deps[key];},module,module.exports);
  const call=(format='csvzip',download='1')=>module.exports.GET(new Request('http://localhost/api/data?aslung_id=AL-1&start=2024-01-01T00:00:00Z&end=2024-01-02T00:00:00Z&download='+download+'&format='+format));
  role='viewer';assert.equal((await call()).status,403);assert.equal(calls,0);
  role='admin';allowed=false;assert.equal((await call()).status,403);assert.equal(calls,0);allowed=true;
  const response=await call();assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/zip/);
  const zip=await JSZip.loadAsync(await response.arrayBuffer(),{checkCRC32:true});
  const csv=await zip.file('aslung_AL-1_export.csv').async('string');assert.equal(calls,2);assert.match(csv,/AL-1,1/);assert.match(csv,/AL-1,2/);
  for(const format of ['csv','json','jsonzip']){
    const res=await call(format);assert.equal(res.headers.get('Content-Type'),'application/zip');
    const archive=await JSZip.loadAsync(await res.arrayBuffer(),{checkCRC32:true});
    if(format==='csv')assert.ok(archive.file('aslung_AL-1_export.csv'));
    else assert.equal(JSON.parse(await archive.file('aslung_AL-1_export.json').async('string')).data.length,2);
  }
  const count=calls;assert.equal((await call('text')).status,400);assert.equal(calls,count);
  const preview=await call('json','0');assert.match(preview.headers.get('Content-Type'),/json/);assert.equal((await preview.json()).data.length,1);
});
