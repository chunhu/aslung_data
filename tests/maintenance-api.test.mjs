import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as maintenance from '../lib/maintenance.mjs';
test('maintenance API protects writes, denies ordinary member records and protects attachment downloads',async()=>{
  const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE devices(id TEXT PRIMARY KEY,status TEXT);INSERT INTO devices VALUES('AL-1','STANDBY');
    CREATE TABLE device_locations(id INTEGER PRIMARY KEY,aslung_id TEXT,active INTEGER,end_time TEXT,start_time TEXT,maintainer TEXT);
    CREATE TABLE maintainers(name TEXT,email TEXT);`);
  let me={role:'admin',email:'admin@test'},signedIn=true;
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const deps={
    '@/lib/server':{identity:async()=>{if(!signedIn)throw new AppError(401,'login');return me;},AppError,fail:e=>Response.json({error:e.message},{status:e.status||500}),writeGuard:req=>{if(req.headers.get('origin')!=='http://test')throw new AppError(403,'origin');}},
    '@/lib/store.mjs':{getConnection:()=>d},'@/lib/maintenance.mjs':maintenance
  };
  const code=ts.transpileModule(readFileSync(new URL('../app/api/maintenance/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>deps[name],module,module.exports);const api=module.exports;
  const get=query=>api.GET(new Request('http://test/api/maintenance'+query));
  const post=(p,origin='http://test')=>api.POST(new Request('http://test/api/maintenance',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(p)}));
  try{
    signedIn=false;assert.equal((await get('')).status,401);signedIn=true;
    assert.equal((await post({},'http://other')).status,403);
    const result=await post({action:'create',device_id:'AL-1',type:'SERVICE',title:'年度保養',description:'例行檢查',reported_date:'2026-10-16'});
    assert.equal(result.status,200);const {id}=await result.json();
    const body=new FormData();body.set('id',id);body.set('file',new File([Buffer.from('%PDF-1.7\nfixture')],'report.pdf',{type:'application/pdf'}));
    const response=await api.POST(new Request('http://test/api/maintenance',{method:'POST',headers:{origin:'http://test'},body}));
    assert.equal(response.status,200);const attachment=(await response.json()).id;
    const download=await get('?attachment='+attachment);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.equal(download.headers.get('cache-control'),'private, no-store');
    me={role:'member',email:'reader@test'};
    assert.equal((await (await get('?capability=1')).json()).canUse,false);
    assert.equal((await get('?id='+id)).status,404);
    assert.equal((await get('?attachment='+attachment)).status,404);
    assert.deepEqual((await (await get('')).json()).orders,[]);
    assert.equal((await post({action:'note',id,content:'not allowed'})).status,404);
    assert.equal((await get('?attachment=missing')).status,404);
  }finally{d.close();}
});

test('deleting a device with maintenance history leaves all grants and deployments intact, including bulk requests',()=>{
  const source=readFileSync(new URL('../app/api/manage/route.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
  const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['protectMaintenanceHistory','deleteDevicesWithHistoryProtection'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
  const code=ts.transpileModule(declarations,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const d=new DatabaseSync(':memory:');d.exec(`CREATE TABLE devices(id TEXT PRIMARY KEY,status TEXT);INSERT INTO devices VALUES('AL-1','STANDBY'),('AL-2','STANDBY');
    CREATE TABLE grants(device_id TEXT);INSERT INTO grants VALUES('AL-1'),('AL-2');
    CREATE TABLE device_locations(aslung_id TEXT);INSERT INTO device_locations VALUES('AL-1'),('AL-2');
    CREATE TABLE maintenance_orders(device_id TEXT);INSERT INTO maintenance_orders VALUES('AL-2');`);
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const remove=new Function('getConnection','AppError',code+'\nreturn deleteDevicesWithHistoryProtection;')(()=>d,AppError);
  try{
    assert.throws(()=>remove(['AL-2']),e=>e.status===409);
    assert.throws(()=>remove(['AL-1','AL-2']),e=>e.status===409);
    for(const table of ['devices','grants','device_locations'])assert.equal(d.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,2);
    remove(['AL-1']);assert.equal(d.prepare('SELECT count(*) AS n FROM devices').get().n,1);
    assert.equal(d.prepare('SELECT count(*) AS n FROM grants').get().n,1);
  }finally{d.close();}
});
