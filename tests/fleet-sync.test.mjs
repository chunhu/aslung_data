import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {previewFleetImport,applyFleetImport} from '../lib/fleet-store.mjs';
import {ensureFleetSyncSchema,saveFleetSchedule,updateFleetSchedule,syncFleetSchedule,fleetSyncState,fetchFleetCsv,fleetGoogleUrl} from '../lib/fleet-sync.mjs';
const email='admin@test',url='https://docs.google.com/spreadsheets/d/example/edit?gid=1';
const header='lab_id,device_id,device_type,maintainer,start_date,end_date,active';
const csv=name=>header+'\nN1,AL-1,aslung,'+name+',2026-01-01,,Y';
function fixture(){const d=new DatabaseSync(':memory:');d.exec(`CREATE TABLE members(email TEXT PRIMARY KEY,active INTEGER,role TEXT);INSERT INTO members VALUES('admin@test',1,'admin');
CREATE TABLE devices(id TEXT PRIMARY KEY,name TEXT,location TEXT,description TEXT,status TEXT);
CREATE TABLE device_locations(id INTEGER PRIMARY KEY,aslung_id TEXT,lab_id TEXT,maintainer TEXT,start_time TEXT,end_time TEXT,active INTEGER);
CREATE TABLE labs(id TEXT);INSERT INTO labs VALUES('N1');CREATE TABLE maintainers(name TEXT);`);ensureFleetSyncSchema(d);return d;}
function apply(d,{enabled=true,intervalMins=60,text=csv('Original')}={}){const preview=previewFleetImport(d,{text}),p={text,fingerprint:preview.fingerprint,schedule:{url,enabled,intervalMins}};return applyFleetImport(d,p,email,{beforeCommit:()=>saveFleetSchedule(d,p,email)});}
function due(d){d.prepare("UPDATE fleet_sync_sources SET next_check='2000-01-01T00:00:00Z'").run();return fleetSyncState(d).sources[0];}
test('import and schedule are atomic; intervals persist, disabled sources do not fetch, repeated imports reuse one schedule',async()=>{
 const d=fixture();try{
  assert.throws(()=>apply(d,{intervalMins:0}),/同步週期/);assert.equal(d.prepare('SELECT COUNT(*) n FROM devices').get().n,0);assert.equal(fleetSyncState(d).sources.length,0);
  apply(d,{intervalMins:120});let s=fleetSyncState(d).sources[0];assert.equal(s.interval_mins,120);assert.ok(Date.parse(s.next_check)>Date.now());
  assert.equal((await syncFleetSchedule(d,s.id,()=>assert.fail('not due'))).status,'SKIPPED');
  apply(d,{enabled:false,intervalMins:15});s=due(d);assert.equal(fleetSyncState(d).sources.length,1);
  assert.equal((await syncFleetSchedule(d,s.id,()=>assert.fail('disabled'))).status,'SKIPPED');
  assert.throws(()=>updateFleetSchedule(d,{id:s.id,revision:s.revision,enabled:true,intervalMins:1.5},email),/同步週期/);
  updateFleetSchedule(d,{id:s.id,revision:s.revision,enabled:true,intervalMins:1440},email);
  assert.throws(()=>updateFleetSchedule(d,{id:s.id,revision:s.revision,enabled:true,intervalMins:30},email),/已異動/);
 }finally{d.close();}
});
test('scheduled sync updates matching deployments, deduplicates repeated data and retains missing historical rows',async()=>{
 const d=fixture();try{
  apply(d);const s=due(d);const r=await syncFleetSchedule(d,s.id,async()=>csv('Updated'));
  assert.equal(r.status,'SUCCESS');assert.equal(r.updated,1);assert.equal(d.prepare('SELECT maintainer FROM device_locations').get().maintainer,'Updated');
  due(d);const again=await syncFleetSchedule(d,s.id,async()=>csv('Updated'));assert.equal(again.unchanged,1);assert.equal(d.prepare('SELECT COUNT(*) n FROM device_locations').get().n,1);
  assert.ok(d.prepare("SELECT 1 FROM device_events WHERE actor='scheduler:admin@test'").get());
  assert.ok(fleetSyncState(d).sources[0].last_success);
 }finally{d.close();}
});
test('changed headers and invalid data reject the whole sync and record the error',async()=>{
 const d=fixture();try{
  apply(d);let s=due(d);assert.equal((await syncFleetSchedule(d,s.id,async()=>csv('Changed').replace('lab_id','site'))).status,'FAILED');
  assert.match(fleetSyncState(d).sources[0].last_message,/欄位已變更/);
  s=due(d);assert.equal((await syncFleetSchedule(d,s.id,async()=>csv('Changed').replace('2026-01-01','not-a-date'))).status,'FAILED');
  assert.match(fleetSyncState(d).sources[0].last_message,/第 2 列/);
  assert.equal(d.prepare('SELECT maintainer FROM device_locations').get().maintainer,'Original');assert.equal(fleetSyncState(d).runs.filter(r=>r.status==='FAILED').length,2);
 }finally{d.close();}
});
test('shared leases prevent duplicate fetches and changing settings during fetch prevents stale writes',async()=>{
 const d=fixture();try{
  apply(d);const s=due(d);let release;const running=syncFleetSchedule(d,s.id,()=>new Promise(resolve=>{release=resolve;}));
  assert.equal((await syncFleetSchedule(d,s.id,()=>assert.fail('already syncing'))).status,'SKIPPED');
  updateFleetSchedule(d,{id:s.id,revision:s.revision,enabled:false,intervalMins:120},email);
  release(csv('Stale'));assert.equal((await running).status,'FAILED');
  assert.equal(d.prepare('SELECT maintainer FROM device_locations').get().maintainer,'Original');assert.equal(fleetSyncState(d).sources[0].enabled,0);
 }finally{d.close();}
});
test('revoked administrators cannot schedule or publish fetched data',async()=>{
 const d=fixture();try{
  apply(d);const s=due(d);let release;const running=syncFleetSchedule(d,s.id,()=>new Promise(resolve=>{release=resolve;}));
  d.prepare("UPDATE members SET role='member'").run();release(csv('Forbidden'));assert.equal((await running).status,'FAILED');
  assert.equal(d.prepare('SELECT maintainer FROM device_locations').get().maintainer,'Original');
  assert.throws(()=>apply(d),/權限/);
 }finally{d.close();}
});
test('Google reader accepts only explicit Google tabs, bounds bytes, and rejects login HTML',async()=>{
 assert.throws(()=>fleetGoogleUrl('https://example.com/spreadsheets/d/x?gid=1'));
 assert.throws(()=>fleetGoogleUrl('https://docs.google.com/spreadsheets/d/x/edit'));
 assert.equal(fleetGoogleUrl('https://docs.google.com/spreadsheets/d/example/edit#gid=1').url,url);
 assert.equal(await fetchFleetCsv(url,async target=>{assert.match(target,/export\?format=csv&gid=1/);return new Response(csv('Name'));}),csv('Name'));
 await assert.rejects(fetchFleetCsv(url,async()=>new Response('<!doctype html><html>Login</html>')),/CSV/);
 await assert.rejects(fetchFleetCsv(url,async()=>new Response('字'.repeat(700000))),/2 MB/);
});
test('daily and weekly settings persist and successful calendar runs advance to the next slot',async()=>{
 const d=fixture();try{
  apply(d);let s=fleetSyncState(d).sources[0];
  updateFleetSchedule(d,{id:s.id,revision:s.revision,enabled:true,scheduleType:'daily',scheduleTime:'05:00',intervalMins:60},email);
  s=fleetSyncState(d).sources[0];assert.equal(s.schedule_type,'daily');assert.equal(s.schedule_time,'05:00');assert.match(s.next_check,/T21:00:00.000Z$/);
  due(d);assert.equal((await syncFleetSchedule(d,s.id,async()=>csv('Original'))).status,'SUCCESS');
  assert.equal((await syncFleetSchedule(d,s.id,()=>assert.fail('same time slot must not run again'))).status,'SKIPPED');
  s=fleetSyncState(d).sources[0];
  updateFleetSchedule(d,{id:s.id,revision:s.revision,enabled:true,scheduleType:'weekly',scheduleTime:'12:30',scheduleDays:'1,4',intervalMins:60},email);
  s=fleetSyncState(d).sources[0];assert.equal(s.schedule_days,'1,4');assert.match(s.next_check,/T04:30:00.000Z$/);
  assert.ok([1,4].includes(new Date(Date.parse(s.next_check)+8*3600000).getUTCDay()));
 }finally{d.close();}
});
test('existing interval schedules migrate without changing the saved next execution',()=>{
 const d=fixture();try{
  d.exec('DROP TABLE fleet_sync_sources;CREATE TABLE fleet_sync_sources(id TEXT PRIMARY KEY,url TEXT,headers_json TEXT,mapping_json TEXT,only_aslung INTEGER,enabled INTEGER,interval_mins INTEGER,next_check TEXT,last_check TEXT,last_success TEXT,last_status TEXT,last_message TEXT,updated_by TEXT,revision INTEGER,lease TEXT,lease_until INTEGER)');
  d.prepare("INSERT INTO fleet_sync_sources(id,interval_mins,next_check) VALUES('legacy',120,'2026-12-31T00:00:00Z')").run();
  ensureFleetSyncSchema(d);ensureFleetSyncSchema(d);const s=fleetSyncState(d).sources[0];assert.equal(s.schedule_type,'interval');assert.equal(s.interval_mins,120);assert.equal(s.next_check,'2026-12-31T00:00:00Z');
 }finally{d.close();}
});
