import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {quickUpdateDevice} from '../lib/fleet-quick-edit.mjs';
import {quickDeviceSnapshot} from '../lib/fleet.mjs';
import {listMaintenance} from '../lib/maintenance.mjs';
const actor='admin@example.test';
function database(){const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE devices(id TEXT PRIMARY KEY,name TEXT,status TEXT,location TEXT);INSERT INTO devices VALUES('AL-1','','DEPLOYED','N1'),('AL-2','','STANDBY','');
 CREATE TABLE device_locations(id INTEGER PRIMARY KEY,aslung_id TEXT REFERENCES devices(id),lab_id TEXT,maintainer TEXT,start_time TEXT,end_time TEXT,active INTEGER);
 INSERT INTO device_locations VALUES(1,'AL-1','N1','甲','2020-01-01T00:00:00Z',NULL,1);
 CREATE TABLE labs(id TEXT PRIMARY KEY);INSERT INTO labs VALUES('N1'),('N2');
 CREATE TABLE maintainers(name TEXT PRIMARY KEY,email TEXT);INSERT INTO maintainers VALUES('甲','a@example.test'),('乙','b@example.test');`);return d;}
function payload(d,extra={}){const id=extra.id||'AL-1',device=d.prepare('SELECT * FROM devices WHERE id=?').get(id),locations=d.prepare('SELECT * FROM device_locations WHERE aslung_id=?').all(id);return {id,field:'status',expected:quickDeviceSnapshot(device,locations),...extra};}

test('quick status ends deployment and logs change; stale requests cannot overwrite it',()=>{
 const d=database();try{
  const p=payload(d,{status:'STANDBY',note:'取回備用'});quickUpdateDevice(d,p,actor);
  assert.equal(d.prepare('SELECT status FROM devices WHERE id=?').get('AL-1').status,'STANDBY');
  assert.equal(d.prepare('SELECT active FROM device_locations').get().active,0);
  assert.match(d.prepare('SELECT note FROM device_events').get().note,/取回備用/);
  assert.throws(()=>quickUpdateDevice(d,p,actor),e=>e.status===409);
 }finally{d.close();}
});
test('quick deployment records old and new periods and updates maintainer and status atomically',()=>{
 const d=database();try{
  quickUpdateDevice(d,payload(d,{field:'location',lab_id:'N2',maintainer:'乙',start_time:'2025-01-01T08:00:00+08:00'}),actor);
  const locations=d.prepare('SELECT * FROM device_locations ORDER BY id').all();
  assert.equal(locations.length,2);assert.equal(locations[0].end_time,'2025-01-01T00:00:00.000Z');
  assert.equal(locations[1].start_time,locations[0].end_time);assert.equal(locations[1].lab_id,'N2');assert.equal(locations[1].maintainer,'乙');
  assert.equal(d.prepare('SELECT location FROM devices WHERE id=?').get('AL-1').location,'N2');
  quickUpdateDevice(d,payload(d,{id:'AL-2',status:'DEPLOYED',lab_id:'N1',maintainer:'',start_time:'2025-01-01T00:00:00Z'}),actor);
  assert.equal(d.prepare('SELECT status FROM devices WHERE id=?').get('AL-2').status,'DEPLOYED');
 }finally{d.close();}
});
test('maintainer edits require a deployment, preserve period and reject stale assignments',()=>{
 const d=database();try{
  const stale=payload(d,{field:'maintainer',maintainer:'乙'});quickUpdateDevice(d,stale,actor);
  const location=d.prepare('SELECT * FROM device_locations').get();assert.equal(location.maintainer,'乙');assert.equal(location.start_time,'2020-01-01T00:00:00Z');
  assert.throws(()=>quickUpdateDevice(d,stale,actor),e=>e.status===409);
  assert.throws(()=>quickUpdateDevice(d,payload(d,{id:'AL-2',field:'maintainer',maintainer:'甲'}),actor),/未部署/);
 }finally{d.close();}
});
test('invalid sites, dates, overlaps, names and future deployments never partially change history',()=>{
 const d=database();try{
  for(const extra of [{lab_id:'missing'},{maintainer:'missing'},{start_time:'invalid'},{start_time:'2025-02-30T00:00:00Z'},{start_time:'2100-01-01T00:00:00Z'},{start_time:'2019-01-01T00:00:00Z'},{lab_id:'N1'}]){
   assert.throws(()=>quickUpdateDevice(d,payload(d,{field:'location',lab_id:'N2',maintainer:'乙',start_time:'2025-01-01T00:00:00Z',...extra}),actor));
  }
  assert.equal(d.prepare('SELECT count(*) AS n FROM device_locations').get().n,1);assert.equal(d.prepare('SELECT lab_id FROM device_locations').get().lab_id,'N1');
  d.exec("INSERT INTO device_locations VALUES(2,'AL-1','N2','乙','2021-01-01T00:00:00Z',NULL,1)");
  assert.throws(()=>quickUpdateDevice(d,payload(d,{status:'STANDBY'}),actor),/重複/);
  assert.equal(d.prepare('SELECT count(*) AS n FROM device_locations WHERE active=1').get().n,2);
 }finally{d.close();}
});
test('repair creation and device state commit together; open work blocks standby or redeployment',()=>{
 const d=database();try{
  assert.throws(()=>quickUpdateDevice(d,payload(d,{status:'MAINTENANCE',create_maintenance:true,repair_title:'',repair_description:'異常'}),actor));
  assert.equal(d.prepare('SELECT active FROM device_locations').get().active,1);
  const result=quickUpdateDevice(d,payload(d,{status:'MAINTENANCE',create_maintenance:true,repair_title:'風扇異常',repair_description:'需要檢修'}),actor);
  const {order}=listMaintenance(d,{role:'admin',email:actor},result.maintenanceId);
  assert.equal(order.lab_snapshot,'N1');assert.equal(order.title,'風扇異常');
  assert.equal(d.prepare('SELECT status FROM devices WHERE id=?').get('AL-1').status,'MAINTENANCE');
  assert.throws(()=>quickUpdateDevice(d,payload(d,{status:'STANDBY'}),actor),/未結案/);
  assert.throws(()=>quickUpdateDevice(d,payload(d,{field:'location',lab_id:'N2',maintainer:'乙',start_time:new Date().toISOString()}),actor),/未結案/);
 }finally{d.close();}
});
