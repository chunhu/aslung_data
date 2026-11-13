import * as realtimeAccess from '../lib/realtime-access.mjs';
import * as activityAuditMock from './helpers/activity-audit.mjs';
import * as activityHttpSecurity from '../lib/http-security.mjs';
import * as activityNodeStream from 'node:stream';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function fixture(){
 const d=new DatabaseSync(':memory:');
 d.exec(`CREATE TABLE device_locations(id INTEGER PRIMARY KEY,aslung_id TEXT);
 INSERT INTO device_locations VALUES(1,'AL-1'),(2,'AL-2'),(3,'AL-3');`);
 let role='admin',syncs=0;
 class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
 const store={prepare(sql){let values=[];return {bind(...v){values=v;return this;},async run(){return d.prepare(sql).run(...values);}};}};
 const deps={'@/lib/store.mjs':{getConnection:()=>d},'@/lib/registration.mjs':{RegistrationError:class extends Error{}},'@/lib/registration-mail':{},'node:crypto':{},'@/lib/passwords.mjs':{},'@/lib/realtime-settings.mjs':{},
 '@/lib/activity-server':activityAuditMock,'@/lib/http-security.mjs':activityHttpSecurity,'node:stream':activityNodeStream,'@/lib/realtime-access.mjs':realtimeAccess,'@/lib/server':{db:()=>store,identity:async()=>({role,email:'test@example.test'}),writeGuard:r=>{if(r.headers.get('origin')!=='http://test')throw new AppError(403,'origin');},AppError,fail:e=>Response.json({error:e.message},{status:e.status||500}),syncDeviceStatusesAndLocations:async()=>{syncs++;},required:v=>{if(typeof v!=='string'||!v.trim())throw new AppError(400,'請完整填寫欄位。');return v.trim();}}};
 const code=ts.transpileModule(readFileSync(new URL('../app/api/manage/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const m={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);
 return {d,role:r=>{role=r;},syncs:()=>syncs,post:(p,origin='http://test')=>m.exports.POST(new Request('http://test/api/manage',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(p)}))};
}
test('single tracking deletion accepts numeric UI IDs and string IDs and removes only the chosen row',async()=>{
 const f=fixture();try{
  assert.equal((await f.post({action:'locationDelete',id:2})).status,200);
  assert.deepEqual(f.d.prepare('SELECT id FROM device_locations ORDER BY id').all().map(r=>r.id),[1,3]);
  assert.equal((await f.post({action:'locationDelete',id:' 3 '})).status,200);
  assert.deepEqual(f.d.prepare('SELECT id FROM device_locations').all().map(r=>r.id),[1]);
  assert.equal(f.syncs(),2);
 }finally{f.d.close();}
});
test('both deletion routes reject invalid IDs without deleting rows or syncing status',async()=>{
 const f=fixture();try{
  for(const id of [undefined,null,'',' ',true,{},[],0,-1,1.2,'1e0','0x1','1 OR 1=1',Number.MAX_SAFE_INTEGER+1]){
   assert.equal((await f.post({action:'locationDelete',id})).status,400,String(id));
   assert.equal((await f.post({action:'locationDeleteBulk',ids:[1,id]})).status,400,String(id));
  }
  assert.equal((await f.post({action:'locationDeleteBulk',ids:[]})).status,400);
  assert.equal(f.d.prepare('SELECT COUNT(*) n FROM device_locations').get().n,3);assert.equal(f.syncs(),0);
 }finally{f.d.close();}
});
test('batch deletion still supports mixed IDs and rolls back if a row cannot be removed',async()=>{
 const f=fixture();try{
  f.d.exec("CREATE TRIGGER protect_tracking BEFORE DELETE ON device_locations WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'protected'); END;");
  assert.equal((await f.post({action:'locationDeleteBulk',ids:[1,2]})).status,500);
  assert.equal(f.d.prepare('SELECT COUNT(*) n FROM device_locations').get().n,3);assert.equal(f.syncs(),0);
  f.d.exec('DROP TRIGGER protect_tracking');
  assert.equal((await f.post({action:'locationDeleteBulk',ids:[1,'2',1]})).status,200);
  assert.deepEqual(f.d.prepare('SELECT id FROM device_locations').all().map(r=>r.id),[3]);assert.equal(f.syncs(),1);
 }finally{f.d.close();}
});
test('tracking deletions remain admin-only and reject foreign origins',async()=>{
 const f=fixture();try{
  for(const action of ['locationDelete','locationDeleteBulk']){
   const p={action,id:1,ids:[1]};
   assert.equal((await f.post(p,'http://other')).status,403);
   f.role('member');assert.equal((await f.post(p)).status,403);f.role('admin');
  }
  assert.equal(f.d.prepare('SELECT COUNT(*) n FROM device_locations').get().n,3);assert.equal(f.syncs(),0);
 }finally{f.d.close();}
});
