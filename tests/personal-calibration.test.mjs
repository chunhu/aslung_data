import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as p from '../lib/personal-calibration.mjs';
import * as c from '../lib/calibration.mjs';
import * as permissions from '../lib/permissions.mjs';
import * as zip from '../lib/csv-zip.mjs';
import * as exportNames from '../lib/export-name.mjs';
import JSZip from 'jszip';
const admin={email:'admin@test',role:'admin'},one={email:'one@test',role:'member'},two={email:'two@test',role:'member'};
const csv=(device='AL-1',a=2)=>`aslung_id,PM,slope1,intercept1,Start_date\n${device},PM1,${a},1,2025/1/1`;
function fixture(){
  const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE members(email TEXT PRIMARY KEY,active INTEGER,role TEXT,name TEXT);
    CREATE TABLE devices(id TEXT PRIMARY KEY,name TEXT,status TEXT);
    CREATE TABLE grants(id INTEGER PRIMARY KEY,grant_type TEXT,device_id TEXT,email TEXT,start TEXT,end TEXT);
    INSERT INTO members VALUES('admin@test',1,'admin','Admin'),('one@test',1,'member','One'),('two@test',1,'member','Two');`);p.ensurePersonalSchema(d);return d;
}
function bind(d,me=one,device='AL-1',start='2025-01-01T00:00:00Z'){
  p.requestDevice(d,me,{device_id:device,evidence:'Purchased device, serial verified'});
  const claim=p.personalState(d,me).claims.find(c=>c.device_id===device&&c.status==='PENDING');
  p.reviewDevice(d,admin,{id:claim.id,decision:'approve',confirmed:true,calibration_enabled:true,create_device:true,start});
  return p.personalState(d,me).ownerships.find(o=>o.device_id===device&&!o.end);
}
function source(d,me=one,kind='CSV'){
  return p.savePersonalSource(d,me,{name:'Research',kind,url:'https://docs.google.com/spreadsheets/d/example/edit?gid=0',auto_sync:kind==='GOOGLE'}).id;
}
function upload(d,id,me=one,content=csv()){
  const version=p.personalState(d,me).sources.find(s=>s.id===id).current_version;
  return p.importPersonalCsv(d,me,{id,version,csv:content});
}
test('ownership requires approval, does not claim existing owners and limits data grants to approved dates',()=>{
  const d=fixture();try{
    p.requestDevice(d,one,{device_id:'AL-1',evidence:'purchase'});
    assert.equal(d.prepare('SELECT COUNT(*) n FROM grants').get().n,0);
    assert.throws(()=>p.requestDevice(d,one,{device_id:'AL-1',evidence:'duplicate'}),/待審核/);
    const claim=p.personalState(d,one).claims[0];
    assert.throws(()=>p.reviewDevice(d,one,{id:claim.id,decision:'approve',calibration_enabled:true}),/只有系統管理員/);
    assert.throws(()=>p.reviewDevice(d,admin,{id:claim.id,decision:'approve',calibration_enabled:true}),/核對|確認/);
    p.reviewDevice(d,admin,{id:claim.id,decision:'approve',calibration_enabled:true,confirmed:true,create_device:true,start:'2026-10-01T00:00:00+08:00'});
    const grant=d.prepare('SELECT * FROM grants').get();assert.equal(grant.email,one.email);assert.equal(grant.start,'2026-09-30T16:00:00.000Z');
    assert.equal(d.prepare('SELECT status FROM devices').get().status,'STANDBY');
    p.requestDevice(d,two,{device_id:'AL-1',evidence:'other applicant'});
    const other=p.personalState(d,two).claims[0];
    assert.throws(()=>p.reviewDevice(d,admin,{id:other.id,decision:'approve',calibration_enabled:true,confirmed:true,start:'2026-10-01T00:00:00Z'}),/已有擁有者/);
    assert.equal(p.personalState(d,two).ownerships.length,0);assert.equal(p.personalState(d,one).claims.length,1);
    d.prepare("UPDATE members SET role='member' WHERE email='admin@test'").run();
    assert.throws(()=>p.reviewDevice(d,admin,{id:other.id,decision:'reject',calibration_enabled:false}),/權限已變更/);
  }finally{d.close();}
});
test('revocation closes only its own grant and prevents overlapping transfers and private calibration use',()=>{
  const d=fixture();try{
    const owned=bind(d);const id=source(d);upload(d,id);
    d.prepare("INSERT INTO grants(grant_type,device_id,email,start,end) VALUES('device','AL-1','one@test','2020-01-01',NULL)").run();
    assert.throws(()=>p.manageOwnership(d,one,{action:'revoke',id:owned.id,confirmation:'REVOKE'}),/只有系統管理員/);
    assert.throws(()=>p.manageOwnership(d,admin,{action:'revoke',id:owned.id}),/REVOKE/);
    p.manageOwnership(d,admin,{action:'revoke',id:owned.id,confirmation:'REVOKE'});
    assert.ok(d.prepare('SELECT end FROM grants WHERE id=?').get(owned.grant_id).end);
    assert.equal(d.prepare('SELECT end FROM grants WHERE id<>?').get(owned.grant_id).end,null);
    assert.throws(()=>p.personalQueryRecords(d,one,'AL-1'),/未核准歸屬/);
    p.requestDevice(d,two,{device_id:'AL-1',evidence:'Transfer'});const claim=p.personalState(d,two).claims[0];
    assert.throws(()=>p.reviewDevice(d,admin,{id:claim.id,decision:'approve',calibration_enabled:true,confirmed:true,start:'2025-01-01T00:00:00Z'}),/交接時間/);
    p.reviewDevice(d,admin,{id:claim.id,decision:'approve',calibration_enabled:true,confirmed:true,start:new Date().toISOString()});
    assert.equal(p.personalState(d,two).ownerships.length,1);assert.throws(()=>p.personalRecords(d,two,id),/找不到/);
  }finally{d.close();}
});
test('only admins can delete released ownership records; grants, transfer boundaries and audit remain',()=>{
  const d=fixture();try{
    const owned=bind(d);
    assert.throws(()=>p.manageOwnership(d,one,{action:'ownershipDelete',id:owned.id,confirmation:'DELETE'}),/只有系統管理員/);
    assert.throws(()=>p.manageOwnership(d,admin,{action:'ownershipDelete',id:owned.id,confirmation:'DELETE'}),/先解除綁定/);
    p.manageOwnership(d,admin,{action:'revoke',id:owned.id,confirmation:'REVOKE'});
    const grants=d.prepare('SELECT * FROM grants').all();
    assert.throws(()=>p.manageOwnership(d,admin,{action:'ownershipDelete',id:owned.id,confirmation:''}),/DELETE/);
    assert.equal(p.personalState(d,one).ownerships.length,1);
    p.manageOwnership(d,admin,{action:'ownershipDelete',id:owned.id,confirmation:'DELETE'});
    assert.equal(p.personalState(d,one).ownerships.length,0);assert.equal(p.personalState(d,admin).ownerships.length,0);
    assert.deepEqual(d.prepare('SELECT * FROM grants').all(),grants);
    assert.ok(d.prepare('SELECT deleted_at FROM device_ownerships WHERE id=?').get(owned.id).deleted_at);
    assert.ok(d.prepare("SELECT 1 FROM personal_events WHERE action='DELETE_OWNERSHIP' AND actor=?").get(admin.email));
    assert.throws(()=>p.manageOwnership(d,admin,{action:'ownershipDelete',id:owned.id,confirmation:'DELETE'}),/找不到/);
    p.requestDevice(d,two,{device_id:'AL-1',evidence:'New owner'});const claim=p.personalState(d,two).claims[0];
    assert.throws(()=>p.reviewDevice(d,admin,{id:claim.id,decision:'approve',confirmed:true,calibration_enabled:true,start:'2025-01-01T00:00:00Z'}),/交接時間/);
  }finally{d.close();}
});
test('private imports validate ownership and permissions; foreign IDs and version guessing never disclose parameters',()=>{
  const d=fixture();try{
    const owned=bind(d);bind(d,two,'AL-2');const id=source(d),other=source(d,two);const first=upload(d,id);const second=upload(d,other,two,csv('AL-2',8));
    assert.equal(p.personalRecords(d,one,id,'').records.length,1);
    assert.throws(()=>p.personalRecords(d,two,id),/找不到/);
    assert.throws(()=>p.personalRecords(d,one,id,second.version),/找不到/);
    assert.throws(()=>p.personalQueryRecords(d,one,'AL-1','personal:'+second.version),/無權/);
    assert.throws(()=>p.previewPersonalCsv(d,one,csv('AL-2')),/未核准/);
    assert.throws(()=>p.importPersonalCsv(d,two,{id,version:first.version,csv:csv('AL-2')}),/找不到/);
    p.manageOwnership(d,admin,{action:'calibrationPermission',id:owned.id,enabled:false});
    assert.throws(()=>p.personalQueryRecords(d,one,'AL-1'),/未核准/);
    assert.throws(()=>p.previewPersonalCsv(d,one,csv()),/未核准/);
    assert.throws(()=>p.personalState(d,{...one,role:'viewer'}),/限研究會員/);
  }finally{d.close();}
});
test('official and personal factors remain isolated and personal versions pin pagination without fallback',async()=>{
  const d=fixture();try{
    bind(d);const id=source(d),first=upload(d,id);c.ensureCalibrationSchema(d);
    const official=c.saveCalibrationSource(d,{name:'Official',url:'https://docs.google.com/spreadsheets/d/example/edit?gid=0'},admin.email);
    await c.syncCalibrationSource(d,official,admin.email,async()=>csv('AL-1',100),{force:true});
    const raw={aslung_id:'AL-1',timestamp:'2026-01-01T00:00:00Z',PM1_G3:3};
    const personal=p.personalQueryRecords(d,one,'AL-1');assert.equal(personal.snapshot,'personal:'+first.version);
    assert.equal(c.calibrateRows([raw],personal.records)[0].PM1_G3_calibrated,7);
    assert.equal(c.calibrateRows([raw],c.currentCalibrationRecords(d))[0].PM1_G3_calibrated,301);
    upload(d,id,one,csv('AL-1',4));assert.equal(c.calibrateRows([raw],p.personalQueryRecords(d,one,'AL-1',personal.snapshot).records)[0].PM1_G3_calibrated,7);
    assert.equal(c.calibrateRows([{...raw,'PM2.5_G3':4}],personal.records)[0]['PM2.5_G3_calibration_status'],'NO_FACTOR');
    assert.throws(()=>p.personalQueryRecords(d,one,'AL-1','1'),/格式/);
    const current=p.personalQueryRecords(d,one,'AL-1').snapshot;
    assert.throws(()=>p.personalQueryRecords(d,one,'AL-1',personal.snapshot+','+current.slice(9)),/同來源/);
  }finally{d.close();}
});
test('private edits, bulk delete, stale versions and source conflicts preserve atomic history',()=>{
  const d=fixture();try{
    bind(d);const id=source(d),first=upload(d,id);
    assert.throws(()=>p.mutatePersonalRecords(d,one,{source_id:id,version:first.version,operation:'edit',ids:[1],patch:{a1:'bad'}}),/數值/);
    const edited=p.mutatePersonalRecords(d,one,{source_id:id,version:first.version,operation:'edit',ids:[1],patch:{a1:0,b1:0}});
    const row=p.personalRecords(d,one,id).records[0];assert.equal(row.a1,0);assert.equal(row.manual_edited_by,one.email);assert.ok(row.manual_edited_at);
    assert.throws(()=>p.mutatePersonalRecords(d,one,{source_id:id,version:first.version,operation:'delete',ids:[1],confirmation:'DELETE'}),/版本/);
    assert.throws(()=>p.mutatePersonalRecords(d,two,{source_id:id,version:edited.version,operation:'delete',ids:[1],confirmation:'DELETE'}),/找不到/);
    const other=source(d);assert.throws(()=>upload(d,other),/重疊/);
    assert.throws(()=>p.mutatePersonalRecords(d,one,{source_id:id,version:edited.version,operation:'delete',ids:[1]}),/DELETE/);
    p.mutatePersonalRecords(d,one,{source_id:id,version:edited.version,operation:'delete',ids:[1],confirmation:'DELETE'});
    assert.equal(p.personalRecords(d,one,id).records.length,0);assert.equal(p.personalRecords(d,one,id,first.version).records[0].a1,2);
    assert.equal(p.personalState(d,one).sources.find(s=>s.id===id).manual,1);
  }finally{d.close();}
});
test('Google private sync respects leases, revocation, overwrite consent and failure protection',async()=>{
  const d=fixture();try{
    const owned=bind(d),id=source(d,one,'GOOGLE');await p.syncPersonalSource(d,one,id,async()=>csv());
    const version=p.personalState(d,one).sources[0].current_version;
    p.mutatePersonalRecords(d,one,{source_id:id,version,operation:'edit',ids:[1],patch:{a1:6}});
    assert.equal((await p.syncPersonalSource(d,one,id,()=>assert.fail('protected'))).status,'SKIPPED');
    let s=p.personalState(d,one).sources[0];p.personalSourceAction(d,one,{action:'sourceSettings',id,version:s.current_version,enabled:true,auto_sync:true,allow_overwrite:true});
    assert.equal((await p.syncPersonalSource(d,one,id,async()=>{throw new Error('offline');})).status,'FAILED');
    assert.equal(p.personalRecords(d,one,id).records[0].a1,6);
    let release;const running=p.syncPersonalSource(d,one,id,()=>new Promise(resolve=>{release=resolve;}));
    assert.throws(()=>p.personalSourceAction(d,one,{action:'sourceDelete',id,confirmation:'DELETE'}),/同步/);
    p.manageOwnership(d,admin,{action:'calibrationPermission',id:owned.id,enabled:false});release(csv());
    assert.equal((await running).status,'FAILED');assert.equal(p.personalRecords(d,one,id).records[0].a1,6);
    p.manageOwnership(d,admin,{action:'calibrationPermission',id:owned.id,enabled:true});
    assert.equal((await p.syncPersonalSource(d,one,id,async()=>csv())).status,'UPDATED');
    const count=d.prepare('SELECT COUNT(*) n FROM personal_versions').get().n;
    await p.syncPersonalSource(d,one,id,async()=>csv());assert.equal(d.prepare('SELECT COUNT(*) n FROM personal_versions').get().n,count);
    assert.equal((await p.syncPersonalSource(d,one,id,()=>assert.fail('future schedule'),{scheduled:true})).status,'SKIPPED');
    d.prepare('UPDATE personal_sources SET next_check=? WHERE id=?').run('2000-01-01T00:00:00Z',id);
    assert.equal((await p.syncPersonalSource(d,one,id,async()=>csv('AL-1',8),{scheduled:true})).status,'UPDATED');
    assert.equal(p.personalRecords(d,one,id).versions[0].created_by,'scheduler');
    p.manageOwnership(d,admin,{action:'calibrationPermission',id:owned.id,enabled:false});
    assert.equal((await p.syncPersonalSource(d,one,id,()=>assert.fail('revocation must prevent external fetch'))).status,'FAILED');
  }finally{d.close();}
});

function load(path,deps){const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);return module.exports;}
test('personal API rejects CSRF, unauthorized writes and cross-member record downloads',async()=>{
  const d=fixture();let actor=one;try{
    bind(d);const id=source(d);upload(d,id);
    class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
    const api=load('../app/api/personal/route.ts',{'@/lib/server':{identity:async()=>actor,writeGuard:req=>{if(req.headers.get('origin')!=='http://test')throw new AppError(403,'origin');},AppError,fail:e=>Response.json({error:e.message},{status:e.status||500})},'@/lib/store.mjs':{getConnection:()=>d},'@/lib/calibration.mjs':c,'@/lib/personal-calibration.mjs':p,'@/lib/calibration-google.mjs':{fetchCalibrationCsv:async()=>csv()}});
    assert.equal((await api.POST(new Request('http://test/api/personal',{method:'POST',body:'{}'}))).status,403);
    actor=two;assert.equal((await api.GET(new Request('http://test/api/personal?source='+id+'&download=1'))).status,404);
    actor={...one,role:'viewer'};assert.equal((await api.GET(new Request('http://test/api/personal'))).status,403);
    actor=one;const r=await api.GET(new Request('http://test/api/personal?source='+id+'&download=1'));assert.equal(r.status,200);assert.match(await r.text(),/AL-1/);
    const owned=p.personalState(d,one).ownerships[0];
    const remove=(origin='http://test',confirmation='DELETE')=>api.POST(new Request('http://test/api/personal',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({action:'ownershipDelete',id:owned.id,confirmation})}));
    assert.equal((await remove()).status,403);
    actor=admin;assert.equal((await remove('http://evil')).status,403);
    assert.equal((await remove()).status,409);
    p.manageOwnership(d,admin,{action:'revoke',id:owned.id,confirmation:'REVOKE'});
    assert.equal((await remove('http://test','')).status,400);
    assert.equal((await remove()).status,200);
    assert.equal((await remove()).status,404);
  }finally{d.close();}
});

test('measurement API applies only private factors, pins export versions and still checks data access',async()=>{
  const d=fixture();let actor=one,denied=false;try{
    bind(d);bind(d,two,'AL-2');const id=source(d),other=source(d,two);upload(d,id);const foreign=upload(d,other,two,csv('AL-2',10));
    class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
    const api=load('../app/api/data/route.ts',{
      '@/lib/server':{identity:async()=>actor,required:v=>v,instant:v=>new Date(v).toISOString(),AppError,
        permitted:async()=>{if(denied)throw new AppError(403,'No data access');},authorizedDataRanges:async()=>[{start:'2026-01-01T00:00:00Z',end:'2026-01-02T00:00:00Z'}],fail:e=>Response.json({error:e.message},{status:e.status||500})},
      '@/lib/store.mjs':{getConnection:()=>d},'@/lib/personal-calibration.mjs':p,'@/lib/calibration.mjs':c,'@/lib/permissions.mjs':permissions,
      '@/lib/csv-zip.mjs':zip,'@/lib/export-name.mjs':exportNames,'@/lib/download-segments.mjs':{},
      '@/lib/data':{fetchPage:async()=>({data:[{aslung_id:'AL-1',timestamp:'2026-01-01T01:00:00Z',PM1_G3:3}],has_more:false,next_cursor:null})}});
    const request=extra=>api.GET(new Request('http://test/api/data?'+new URLSearchParams({aslung_id:'AL-1',start:'2026-01-01T00:00:00Z',end:'2026-01-02T00:00:00Z',calibration:'personal',...extra})));
    const first=await (await request({})).json();assert.equal(first.data[0].PM1_G3_calibrated,7);assert.equal(first.data[0]._calibration_scope,'personal');
    upload(d,id,one,csv('AL-1',4));
    const archive=await JSZip.loadAsync(await (await request({calibration_snapshot:first.calibration_snapshot,download:'1',format:'jsonzip'})).arrayBuffer());
    const content=JSON.parse(await archive.file(Object.keys(archive.files).find(name=>name.endsWith('.json'))).async('string'));
    assert.equal(content.data[0].PM1_G3_calibrated,7);assert.equal(content.calibration,'personal');
    assert.equal((await request({calibration_snapshot:'personal:'+foreign.version})).status,403);
    const official=await (await request({calibration:'both'})).json();assert.equal(official.data[0].PM1_G3_calibration_status,'NO_FACTOR');
    denied=true;assert.equal((await request({})).status,403);denied=false;
    actor=two;assert.equal((await request({calibration_snapshot:first.calibration_snapshot})).status,403);
  }finally{d.close();}
});
