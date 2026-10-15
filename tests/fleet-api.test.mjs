import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as fleet from '../lib/fleet-store.mjs';

test('fleet API enforces admin and origin, previews without mutation and validates Google source',async()=>{
  const d=new DatabaseSync(':memory:');
  d.exec(`CREATE TABLE devices(id TEXT PRIMARY KEY,name TEXT,location TEXT,description TEXT,status TEXT);
    CREATE TABLE device_locations(id INTEGER PRIMARY KEY,aslung_id TEXT,lab_id TEXT,maintainer TEXT,start_time TEXT,end_time TEXT,active INTEGER);
    CREATE TABLE labs(id TEXT);INSERT INTO labs VALUES('N1');CREATE TABLE maintainers(name TEXT);`);
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  let role='admin';
  const dependencies={
    '@/lib/server':{identity:async()=>({role,email:'admin@example.test'}),AppError,
      writeGuard:req=>{if(req.headers.get('origin')!=='http://fleet.test')throw new AppError(403,'origin');},
      fail:e=>Response.json({error:e.message},{status:e.status||500}),syncDeviceStatusesAndLocations:async()=>{}},
    '@/lib/store.mjs':{getConnection:()=>d},'@/lib/fleet-store.mjs':fleet
  };
  const code=ts.transpileModule(readFileSync(new URL('../app/api/fleet/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','exports','module',code)(name=>{assert.ok(name in dependencies);return dependencies[name];},module.exports,module);
  const route=module.exports;
  const post=(body,origin='http://fleet.test')=>route.POST(new Request('http://fleet.test/api/fleet',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  try{
    assert.equal((await post({action:'previewImport'},'http://other.test')).status,403);
    role='member';assert.equal((await post({action:'bulk',ids:['AL-1']})).status,403);
    assert.equal((await route.GET(new Request('http://fleet.test/api/fleet?id=AL-1'))).status,403);
    role='admin';
    const text='lab_id,device_id,device_type,start_date\nN1,AL-1,aslung,2026-10-01';
    const response=await post({action:'previewImport',text});assert.equal(response.status,200);
    const preview=await response.json();assert.equal(preview.added,1);assert.equal(preview.canApply,true);
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM devices').get().n,0);
    assert.equal((await post({action:'applyImport',text,fingerprint:preview.fingerprint})).status,200);
    const history=await route.GET(new Request('http://fleet.test/api/fleet?id=AL-1'));assert.equal(history.status,200);
    assert.equal((await history.json()).events[0].actor,'admin@example.test');
    assert.equal((await route.GET(new Request('http://fleet.test/api/fleet?id=unknown'))).status,404);
    assert.equal((await post({action:'googleSource',url:'https://example.test/spreadsheets/d/private?gid=1'})).status,400);
    assert.equal((await post({action:'googleSource',url:'https://docs.google.com/spreadsheets/d/example/edit'})).status,400);
  }finally{d.close();}
});
