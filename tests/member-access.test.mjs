import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as permissions from '../lib/permissions.mjs';
import * as access from '../lib/member-access.mjs';
const admin={role:'admin',email:'admin@test'};
function fixture(){
  const d=new DatabaseSync(':memory:');
  d.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE members(email TEXT PRIMARY KEY,user_id TEXT UNIQUE,name TEXT,role TEXT CHECK(role IN ('admin','member')),active INTEGER,password_hash TEXT,alert_email_enabled INTEGER DEFAULT 1);
    CREATE UNIQUE INDEX member_ids ON members(user_id);
    INSERT INTO members VALUES('admin@test','admin','Admin','admin',1,'hash',1),('member@test','member','Member','member',1,'hash',0);
    CREATE TABLE devices(id TEXT PRIMARY KEY,name TEXT,description TEXT,status TEXT,location TEXT);
    INSERT INTO devices VALUES('AL-1','One','','STANDBY',''),('AL-2','Two','','STANDBY','');
    CREATE TABLE sessions(id TEXT PRIMARY KEY,email TEXT REFERENCES members(email) ON DELETE CASCADE);
    INSERT INTO sessions VALUES('session','member@test');
    CREATE TABLE grants(id INTEGER PRIMARY KEY,email TEXT REFERENCES members(email) ON DELETE CASCADE,device_id TEXT REFERENCES devices(id));
    INSERT INTO grants VALUES(1,'member@test','AL-2');
    CREATE TABLE member_profiles(email TEXT PRIMARY KEY REFERENCES members(email) ON DELETE CASCADE,registration_status TEXT);
    INSERT INTO member_profiles VALUES('member@test','approved');
    CREATE TABLE labs(id TEXT PRIMARY KEY,location_name TEXT,city_name TEXT,town_name TEXT);
    CREATE TABLE maintainers(name TEXT,english_name TEXT,email TEXT);
    CREATE TABLE device_locations(id INTEGER PRIMARY KEY,aslung_id TEXT,lab_id TEXT,maintainer TEXT,start_time TEXT,end_time TEXT,active INTEGER);
    INSERT INTO device_locations VALUES(1,'AL-1','Lab','', '2020-01-01',NULL,1),(2,'AL-2','Other','', '2020-01-01',NULL,1);`);
  return d;
}
function load(path,deps){const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);return module.exports;}
test('two-role migration preserves members, preferences, sessions, grants, indexes and foreign keys and reopens idempotently',()=>{
  const d=fixture();try{
    access.ensureMemberAccessSchema(d);access.ensureMemberAccessSchema(d);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM members').get().n,2);assert.equal(d.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);assert.equal(d.prepare('SELECT COUNT(*) n FROM grants').get().n,1);
    assert.equal(d.prepare("SELECT alert_email_enabled FROM members WHERE email='member@test'").get().alert_email_enabled,0);
    assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(d.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
    for(const role of ['device_manager','calibration_manager','viewer','member'])d.prepare("UPDATE members SET role=? WHERE email='member@test'").run(role);
    assert.throws(()=>d.prepare("UPDATE members SET role='superuser' WHERE email='member@test'").run(),/CHECK/);
    assert.throws(()=>d.prepare("INSERT INTO members(email,user_id,role) VALUES('new@test','member','member')").run(),/UNIQUE/);
  }finally{d.close();}
});
test('role and explicit write scopes are atomic and never derive from or alter data grants',()=>{
  const d=fixture();try{
    access.saveMemberAccess(d,admin,{email:'member@test',role:'device_manager',device_ids:['AL-1']});
    const me={role:'device_manager',email:'member@test'};
    assert.deepEqual([...access.managedDeviceIds(d,me)],['AL-1']);access.assertManagedDevice(d,me,'AL-1');assert.throws(()=>access.assertManagedDevice(d,me,'AL-2'),/管理範圍/);
    assert.equal(d.prepare('SELECT device_id FROM grants').get().device_id,'AL-2');
    assert.throws(()=>access.saveMemberAccess(d,admin,{email:'member@test',role:'device_manager',device_ids:['AL-2','missing']}),/不存在/);
    assert.deepEqual([...access.managedDeviceIds(d,me)],['AL-1']);assert.equal(d.prepare('SELECT COUNT(*) n FROM member_access_events').get().n,1);
    access.saveMemberAccess(d,admin,{email:'member@test',role:'viewer',device_ids:[]});
    assert.equal(d.prepare('SELECT COUNT(*) n FROM member_device_scopes').get().n,0);assert.equal(d.prepare('SELECT COUNT(*) n FROM grants').get().n,1);
    assert.throws(()=>access.assertManagedDevice(d,me,'AL-1'),/管理範圍/); // Stale caller role must not retain access.
  }finally{d.close();}
});
test('self changes, pending registrations, invalid roles, member escalation and dormant accounts are denied',()=>{
  const d=fixture();try{
    access.ensureMemberAccessSchema(d);
    const input={email:'member@test',role:'device_manager',device_ids:[]};
    assert.throws(()=>access.saveMemberAccess(d,{role:'member',email:'member@test'},input),/只有系統管理員/);
    assert.throws(()=>access.saveMemberAccess(d,admin,{...input,email:'admin@test'}),/自己/);
    assert.throws(()=>access.saveMemberAccess(d,admin,{...input,role:'superuser'}),/正確/);
    d.exec("UPDATE member_profiles SET registration_status='pending_review'");assert.throws(()=>access.saveMemberAccess(d,admin,input),/審核/);
    d.exec("UPDATE member_profiles SET registration_status='approved'");access.saveMemberAccess(d,admin,{...input,device_ids:['AL-1']});d.exec("UPDATE members SET active=0 WHERE email='member@test'");
    assert.throws(()=>access.assertManagedDevice(d,{role:'device_manager',email:'member@test'},'AL-1'),/管理範圍/);
  }finally{d.close();}
});
test('capabilities separate calibration, equipment, data export and viewer writes',()=>{
  assert.equal(Object.keys(permissions.MEMBER_ROLES).length,5);
  for(const role of Object.keys(permissions.MEMBER_ROLES)){
    assert.equal(permissions.canManageCalibration({role}),['admin','calibration_manager'].includes(role));
    assert.equal(permissions.canManageDevices({role}),['admin','device_manager'].includes(role));
    assert.equal(permissions.canExportData({role}),role!=='viewer');assert.equal(permissions.canWriteMaintenance({role}),role!=='viewer');
  }
  assert.equal(permissions.canExportData({role:'unknown'}),false);
});
test('device management endpoints hide out-of-scope devices and reject tampered writes, including revocation before commit',async()=>{
  const d=fixture();let me={role:'device_manager',email:'member@test'},writes=0,revoke=false;
  access.saveMemberAccess(d,admin,{email:me.email,role:me.role,device_ids:['AL-1']});
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const fleet=await import('../lib/fleet-store.mjs');
  const server={identity:async()=>me,AppError,fail:e=>Response.json({error:e.message},{status:e.status||500}),writeGuard:r=>{if(r.headers.get('origin')!=='http://test')throw new AppError(403,'origin');}};
  const api=load('../app/api/device-management/route.ts',{'@/lib/server':server,'@/lib/store.mjs':{getConnection:()=>d},'@/lib/permissions.mjs':permissions,'@/lib/member-access.mjs':access,'@/lib/fleet-store.mjs':fleet,'@/lib/fleet-quick-edit.mjs':{quickUpdateDevice:(db,p,email,authorize)=>{if(revoke)d.prepare('DELETE FROM member_device_scopes').run();authorize();writes++;return {updated:1};}}});
  const post=(p,origin='http://test')=>api.POST(new Request('http://test/api/device-management',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(p)}));
  try{
    let response=await api.GET(new Request('http://test/api/device-management'));assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.devices.map(r=>r.id),['AL-1']);assert.ok(body.locations.every(r=>r.aslung_id==='AL-1'));
    assert.equal((await post({action:'quick',id:'AL-2'})).status,403);assert.equal((await post({action:'quick',id:'AL-1'},'http://evil')).status,403);assert.equal(writes,0);
    assert.equal((await post({action:'quick',id:'AL-1'})).status,200);assert.equal(writes,1);
    revoke=true;assert.equal((await post({action:'quick',id:'AL-1'})).status,403);assert.equal(writes,1);
    me={role:'viewer',email:'member@test'};assert.equal((await api.GET(new Request('http://test/api/device-management'))).status,403);
  }finally{d.close();}
});


test('device manager maintenance is strictly scoped even when an out-of-scope order names them as responsible',async()=>{
  const d=fixture();const maintenance=await import('../lib/maintenance.mjs');try{
    access.saveMemberAccess(d,admin,{email:'member@test',role:'device_manager',device_ids:['AL-1']});
    d.exec("INSERT INTO maintainers VALUES('Owner','','member@test'); UPDATE device_locations SET maintainer='Owner' WHERE aslung_id='AL-2'");
    const outside=maintenance.saveMaintenance(d,admin,{action:'create',device_id:'AL-2',type:'REPAIR',title:'Other device',description:'Restricted order',reported_date:'2026-01-01',assignee:'Owner'});
    const me={role:'device_manager',email:'member@test'};
    assert.throws(()=>maintenance.listMaintenance(d,me,outside.id),/找不到可存取/);
    assert.throws(()=>maintenance.saveMaintenance(d,me,{action:'create',device_id:'AL-2',type:'REPAIR',title:'No',description:'No',reported_date:'2026-01-01'}),/目前負責/);
    const inside=maintenance.saveMaintenance(d,me,{action:'create',device_id:'AL-1',type:'REPAIR',title:'Assigned device',description:'Allowed order',reported_date:'2026-01-01',set_maintenance:true});
    assert.ok(maintenance.listMaintenance(d,me,inside.id).order);
    access.saveMemberAccess(d,admin,{email:'member@test',role:'viewer',device_ids:[]});
    assert.throws(()=>maintenance.saveMaintenance(d,{role:'viewer',email:'member@test'},{action:'note',id:inside.id,content:'No'}),/檢視會員不能修改/);
    assert.throws(()=>maintenance.addMaintenanceAttachment(d,{role:'viewer',email:'member@test'},inside.id,{name:'test.pdf'},Buffer.from('%PDF-')),/檢視會員不能上傳/);
  }finally{d.close();}
});


test('a stale administrator identity cannot grant roles after system access is revoked',()=>{
  const d=fixture();try{
    access.ensureMemberAccessSchema(d);d.exec("UPDATE members SET role='member' WHERE email='admin@test'");
    assert.throws(()=>access.saveMemberAccess(d,admin,{email:'member@test',role:'admin',device_ids:[]}),/系統管理權限已變更/);
    assert.equal(d.prepare("SELECT role FROM members WHERE email='member@test'").get().role,'member');
    assert.equal(d.prepare('SELECT COUNT(*) n FROM member_access_events').get().n,0);
  }finally{d.close();}
});
