import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as grants from '../lib/data-grants.mjs';
const actor={email:'admin@test',role:'admin'};
const input={grantType:'device',targets:['D1','D2'],email:'member@test',start:'2026-10-30T08:00:00+08:00',end:null};
function fixture(){const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE members(email TEXT PRIMARY KEY,role TEXT,active INTEGER);
 INSERT INTO members VALUES('admin@test','admin',1),('member@test','member',1);
 CREATE TABLE devices(id TEXT PRIMARY KEY); INSERT INTO devices VALUES('D1'),('D2');
 CREATE TABLE labs(id TEXT PRIMARY KEY); INSERT INTO labs VALUES('L1'),('L2');
 CREATE TABLE grants(id INTEGER PRIMARY KEY,grant_type TEXT,device_id TEXT REFERENCES devices(id),lab_id TEXT REFERENCES labs(id),email TEXT REFERENCES members(email),start TEXT,end TEXT);
 `);return d;}
test('multiple device and lab grants share dates, deduplicate selections and skip exact existing grants',()=>{
 const d=fixture();try{
  assert.deepEqual(grants.createBulkGrants(d,actor,{...input,targets:['D1',' D2 ','D1']}),{created:2,skipped:0});
  assert.deepEqual(grants.createBulkGrants(d,actor,input),{created:0,skipped:2});
  assert.deepEqual(grants.createBulkGrants(d,actor,{...input,grantType:'lab',targets:['L1','L2'],end:'2026-11-01T00:00Z'}),{created:2,skipped:0});
  const rows=d.prepare('SELECT * FROM grants ORDER BY id').all();assert.equal(rows.length,4);
  assert.ok(rows.every(r=>r.email===input.email&&r.start==='2026-10-30T00:00:00.000Z'));
  assert.ok(rows.slice(2).every(r=>r.device_id===null&&r.end==='2026-11-01T00:00:00.000Z'));
  // A different period remains a separate, deliberate grant.
  assert.equal(grants.createBulkGrants(d,actor,{...input,end:'2026-11-02T00:00Z'}).created,2);
 }finally{d.close();}
});
test('invalid targets, inactive members, stale admin access and invalid dates cannot create partial access',()=>{
 const d=fixture();try{
  for(const invalid of [{targets:['D1','missing']},{targets:[]},{targets:['D1',42]},{grantType:'anything'},{start:'bad'},{end:'2026-01-01'},{email:'missing@test'}])assert.throws(()=>grants.createBulkGrants(d,actor,{...input,...invalid}));
  d.exec("UPDATE members SET active=0 WHERE email='member@test'");assert.throws(()=>grants.createBulkGrants(d,actor,input),/啟用/);
  d.exec("UPDATE members SET active=1; UPDATE members SET role='member' WHERE email='admin@test'");assert.throws(()=>grants.createBulkGrants(d,actor,input),/系統管理員/);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM grants').get().n,0);assert.equal(d.isTransaction,false);
 }finally{d.close();}
});
test('a write failure midway rolls back every grant in the batch',()=>{
 const d=fixture();try{
  d.exec("CREATE TRIGGER deny_second BEFORE INSERT ON grants WHEN NEW.device_id='D2' BEGIN SELECT RAISE(ABORT,'simulated write failure'); END;");
  assert.throws(()=>grants.createBulkGrants(d,actor,input),/simulated write failure/);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM grants').get().n,0);assert.equal(d.isTransaction,false);
 }finally{d.close();}
});
function load(file,deps){const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;const m={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);return m.exports;}
test('manage endpoint enforces admin and origin checks and returns accurate batch counts',async()=>{
 const d=fixture();let me=actor;
 class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
 const server={identity:async()=>me,AppError,writeGuard:r=>{if(r.headers.get('origin')!=='http://test')throw new AppError(403,'origin');},instant:s=>{if(!Number.isFinite(Date.parse(s)))throw new AppError(400,'date');return new Date(s).toISOString();},fail:e=>Response.json({error:e.message},{status:e.status||500})};
 const api=load('../app/api/manage/route.ts',{'@/lib/server':server,'@/lib/store.mjs':{getConnection:()=>d},'@/lib/registration.mjs':{RegistrationError:class extends Error{}},'@/lib/registration-mail':{},'@/lib/passwords.mjs':{},'@/lib/realtime-settings.mjs':{},'node:crypto':{},'@/lib/data-grants.mjs':grants});
 const post=(p,origin='http://test')=>api.POST(new Request('http://test/api/manage',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({action:'grantBulk',...input,...p})}));
 try{
  assert.equal((await post({},'http://evil')).status,403);me={email:'member@test',role:'member'};assert.equal((await post({})).status,403);me=actor;
  assert.deepEqual(await (await post({})).json(),{ok:true,created:2,skipped:0});
  assert.deepEqual(await (await post({})).json(),{ok:true,created:0,skipped:2});
  assert.equal((await post({targets:['D1','missing']})).status,400);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM grants').get().n,2);
 }finally{d.close();}
});
function find(node,predicate){if(!React.isValidElement(node))return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const found=find(child,predicate);if(found)return found;}return null;}
test('target selector supports all options despite a search, additive search selection, individual deselection and clear',()=>{
 const updates=[];
 const {default:View}=load('../components/GrantTargetSelect.tsx',{'react':{useState:()=>['Two',()=>{}]},'react/jsx-runtime':jsx,'@/components/ui/button':{Button:'button'},'@/components/ui/input':{Input:'input'}});
 const tree=View({kind:'device',options:[{value:'D1',label:'One'},{value:'D2',label:'Two'},{value:'D3',label:'Three'}],value:['D1','D2'],onChange:v=>updates.push(v)});
 const button=text=>find(tree,n=>n.type==='button'&&React.Children.toArray(n.props.children).includes(text));
 button('全選（').props.onClick();assert.deepEqual(updates.pop(),['D1','D2','D3']);
 button('選取搜尋結果（').props.onClick();assert.deepEqual(updates.pop(),['D1','D2']);
 find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:false}});assert.deepEqual(updates.pop(),['D1']);
 button('清除選取').props.onClick();assert.deepEqual(updates.pop(),[]);
});
