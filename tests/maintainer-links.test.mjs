import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as links from '../lib/maintainer-links.mjs';
const admin={email:'admin@test',user_id:'a',role:'admin'},member={email:'member@test',user_id:'b',role:'member'};
const now=new Date('2026-10-20T08:00:00Z');
function fixture(){
  const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE members(email TEXT PRIMARY KEY,user_id TEXT UNIQUE,name TEXT,role TEXT,active INTEGER,alert_email_enabled INTEGER);
    INSERT INTO members VALUES('admin@test','a','Admin','admin',1,1),('member@test','b','Owner','member',1,1),('other@test','c','Owner','member',1,1);
    CREATE TABLE maintainers(name TEXT PRIMARY KEY,english_name TEXT,email TEXT);
    INSERT INTO maintainers VALUES('Owner','Full English Name','member@test'),('Shared','Shared Name','member@test'),('Other','Other Name','other@test');
    CREATE TABLE devices(id TEXT PRIMARY KEY,status TEXT);
    INSERT INTO devices VALUES('AL-1','DEPLOYED'),('AL-2','DEPLOYED'),('AL-3','DEPLOYED');
    CREATE TABLE device_locations(id INTEGER PRIMARY KEY,aslung_id TEXT REFERENCES devices(id),lab_id TEXT,maintainer TEXT,start_time TEXT,end_time TEXT,active INTEGER);
    INSERT INTO device_locations VALUES(1,'AL-1','Lab-1','Owner','2026-10-01',NULL,1),(2,'AL-2','Lab-2','Other','2026-10-01',NULL,1),(3,'AL-3','Lab-3','Owner','2026-01-01','2026-09-01',1);
    CREATE TABLE grants(id INTEGER PRIMARY KEY,email TEXT,device_id TEXT,start TEXT,end TEXT);
    INSERT INTO grants VALUES(1,'member@test','AL-2','2025-01-01',NULL);
    CREATE TABLE member_profiles(email TEXT PRIMARY KEY,registration_status TEXT);
    INSERT INTO member_profiles VALUES('member@test','approved'),('other@test','approved');
    CREATE TABLE alert_settings(id INTEGER PRIMARY KEY,offline_threshold_mins INTEGER);
    INSERT INTO alert_settings VALUES(1,60);`);
  links.ensureMaintainerLinkSchema(d);return d;
}
const identity=(d,name)=>d.prepare('SELECT maintainer_id FROM maintainers WHERE name=?').get(name).maintainer_id;
function bind(d,ids,email='member@test'){
  const detail=links.maintainerLinkDetails(d,admin,email);
  links.saveMaintainerLinks(d,admin,{email,maintainer_ids:ids,revision:detail.revision});
}
const store=d=>({prepare(sql){let params=[];return {bind(...p){params=p;return this;},async all(){return {results:d.prepare(sql).all(...params)};},async first(){return d.prepare(sql).get(...params);}};}});

test('migration preserves data, creates persistent IDs and never auto-links shared email or matching names',()=>{
  const d=fixture();try{
    const id=identity(d,'Owner');links.ensureMaintainerLinkSchema(d);assert.equal(identity(d,'Owner'),id);
    assert.match(id,/^[a-f0-9]{32}$/);assert.equal(d.prepare('SELECT COUNT(*) n FROM member_maintainer_links').get().n,0);
    assert.equal(links.myMaintainedDevices(d,member,now).devices.length,0);
    assert.equal(links.maintainerLinkDetails(d,admin,member.email).suggested_ids.length,2);
    assert.deepEqual(d.prepare('PRAGMA foreign_key_check').all(),[]);
    d.prepare("INSERT INTO maintainers VALUES('Inserted','Inserted','later@test',NULL)").run();assert.match(identity(d,'Inserted'),/^[a-f0-9]{32}$/);
  }finally{d.close();}
});
test('explicit links show only current responsibility, support stable renames and immediately follow handover',()=>{
  const d=fixture();try{
    const owner=identity(d,'Owner'),before=d.prepare('SELECT * FROM grants').all();bind(d,[owner]);
    assert.deepEqual(links.myMaintainedDevices(d,member,now).devices.map(r=>r.id),['AL-1']);
    assert.equal(links.myMaintainedDevices(d,{...member,email:'other@test',user_id:'c'},now).devices.length,0);
    d.prepare("UPDATE maintainers SET name='Renamed',english_name='Correct Full Name',email='updated@test' WHERE maintainer_id=?").run(owner);
    const maintained=links.myMaintainedDevices(d,member,now);assert.equal(maintained.identities[0].maintainer_id,owner);assert.equal(maintained.devices[0].maintainer,'Renamed');
    d.exec("INSERT INTO device_locations VALUES(4,'AL-1','New Lab','Other','2026-10-20T07:00:00Z',NULL,1,NULL)");
    assert.equal(links.myMaintainedDevices(d,member,now).devices.length,0); // stale overlapping assignment does not retain access
    d.exec('DELETE FROM device_locations WHERE id=4');assert.equal(links.myMaintainedDevices(d,member,now).devices.length,1);
    bind(d,[]);assert.equal(links.myMaintainedDevices(d,member,now).devices.length,0);
    assert.deepEqual(d.prepare('SELECT * FROM grants').all(),before);
    assert.equal(d.prepare('SELECT role FROM members WHERE user_id=?').get('b').role,'member');
    assert.equal(d.prepare('SELECT COUNT(*) n FROM member_maintainer_link_events').get().n,2);
  }finally{d.close();}
});
test('admin-only binding allows self links, validates IDs and revisions, and rejects stale identities or unapproved accounts',()=>{
  const d=fixture();try{
    const owner=identity(d,'Owner'),payload={email:'member@test',maintainer_ids:[owner],revision:0};
    assert.throws(()=>links.saveMaintainerLinks(d,member,payload),e=>e.status===403);
    assert.throws(()=>links.saveMaintainerLinks(d,admin,{...payload,maintainer_ids:['0'.repeat(32)]}));
    links.saveMaintainerLinks(d,admin,payload);assert.throws(()=>links.saveMaintainerLinks(d,admin,payload),e=>e.status===409);
    bind(d,[owner],'admin@test');assert.equal(links.myMaintainedDevices(d,admin,now).devices.length,1);
    d.exec("UPDATE member_profiles SET registration_status='pending_review' WHERE email='other@test'");assert.throws(()=>bind(d,[owner],'other@test'),/審核/);
    d.exec("UPDATE members SET active=0 WHERE user_id='b'");assert.throws(()=>links.myMaintainedDevices(d,member,now),e=>e.status===403);
    assert.throws(()=>links.myMaintainedDevices(d,{...admin,user_id:'wrong'},now),e=>e.status===403);
    d.exec("UPDATE members SET role='member' WHERE user_id='a'");assert.throws(()=>links.saveMaintainerLinks(d,admin,{...payload,revision:1}),e=>e.status===403);
  }finally{d.close();}
});
test('deleting a maintainer revokes links; recreating the same name cannot inherit authorization',()=>{
  const d=fixture();try{
    const owner=identity(d,'Owner');bind(d,[owner]);d.prepare('DELETE FROM maintainers WHERE maintainer_id=?').run(owner);
    d.exec("INSERT INTO maintainers(name,english_name,email) VALUES('Owner','','member@test')");assert.notEqual(identity(d,'Owner'),owner);
    assert.equal(links.myMaintainedDevices(d,member,now).devices.length,0);assert.equal(d.prepare('SELECT COUNT(*) n FROM member_maintainer_links').get().n,0);
  }finally{d.close();}
});
test('explicit email routing follows linked accounts, opt-outs and unlinking without legacy fallback',async()=>{
  const d=fixture();try{
    const person=d.prepare("SELECT * FROM maintainers WHERE name='Owner'").get(),s=store(d);
    assert.equal(await links.explicitAlertRecipients(s,person),null);
    bind(d,[person.maintainer_id],'other@test');assert.deepEqual(await links.explicitAlertRecipients(s,person),['other@test']);
    d.exec("UPDATE members SET alert_email_enabled=0 WHERE email='other@test'");assert.deepEqual(await links.explicitAlertRecipients(s,person),[]);
    bind(d,[],'other@test');assert.deepEqual(await links.explicitAlertRecipients(s,person),[]);
    d.exec("INSERT INTO members VALUES('temp@local.aslung','z','Temp','member',1,1)");
    bind(d,[person.maintainer_id],'temp@local.aslung');assert.deepEqual(await links.explicitAlertRecipients(s,person),[]);
  }finally{d.close();}
});
test('connection classification uses the configured threshold; no uploads, year-old and invalid timestamps remain distinguishable',()=>{
  assert.equal(links.connectionStatus(new Date(now-60*60000),60,now).status,'ONLINE');
  assert.equal(links.connectionStatus(new Date(now-61*60000),60,now).status,'OFFLINE');
  assert.equal(links.connectionStatus(null,60,now).status,'NO_DATA');
  assert.match(links.connectionStatus('2024-01-01',60,now).email_exclusion,/一年/);
  assert.equal(links.connectionStatus(new Date(+now+1),60,now).status,'UNKNOWN');
});
function load(path,deps){const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const module={exports:{}};new Function('require','module','exports',code)(key=>{assert.ok(key in deps,key);return deps[key];},module,module.exports);return module.exports;}
test('status API ignores arbitrary target accounts, returns no measurement values, and rechecks scope after remote reads',async()=>{
  const d=fixture();let calls=0,revoke=false,mode='offline';
  try{
    bind(d,[identity(d,'Owner')]);
    const api=load('../app/api/my-maintained-devices/route.ts',{
      '@/lib/server':{identity:async()=>member,fail:e=>Response.json({error:e.message},{status:e.status||500})},'@/lib/store.mjs':{getConnection:()=>d},'@/lib/maintainer-links.mjs':links,
      '@/lib/data':{getPool:()=>({query:async({sql,values})=>{calls++;assert.match(sql,/^SELECT time /);assert.deepEqual(values,['AL-1']);if(revoke)bind(d,[]);if(mode==='error')throw new Error('database details');return [mode==='empty'?[]:[{time:new Date(Date.now()-90*60000)}]];}})}
    });
    const call=()=>api.GET(new Request('http://localhost/api/my-maintained-devices?email=other@test'));
    const result=await (await call()).json();assert.equal(result.summary.offline,1);assert.equal(result.devices[0].id,'AL-1');assert.equal(result.devices[0].PM1_G3,undefined);
    mode='error';const failed=await (await call()).json();assert.equal(failed.summary.unknown,1);assert.equal(failed.summary.offline,0);assert.ok(!JSON.stringify(failed).includes('database details'));
    mode='empty';const empty=await (await call()).json();assert.equal(empty.summary.no_data,1);assert.match(empty.devices[0].email_exclusion,/從未/);
    revoke=true;assert.equal((await (await call()).json()).summary.total,0);
    const count=calls;assert.equal((await (await call()).json()).identities.length,0);assert.equal(calls,count);
  }finally{d.close();}
});
test('link API rejects non-admin reads/writes and foreign origins, while administrators can link themselves',async()=>{
  const d=fixture();let me=member,origin=true;
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const api=load('../app/api/maintainer-links/route.ts',{'@/lib/server':{AppError,identity:async()=>me,writeGuard:()=>{if(!origin)throw new AppError(403,'origin');},fail:e=>Response.json({error:e.message},{status:e.status||500})},'@/lib/store.mjs':{getConnection:()=>d},'@/lib/maintainer-links.mjs':links});
  const get=()=>api.GET(new Request('http://localhost/api/maintainer-links?email=admin@test'));
  const post=body=>api.POST(new Request('http://localhost/api/maintainer-links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  try{
    assert.equal((await get()).status,403);assert.equal((await post({})).status,403);
    me=admin;const detail=await (await get()).json();assert.equal(detail.linked_ids.length,0);assert.equal(detail.maintainers.length,3);
    origin=false;assert.equal((await post({})).status,403);origin=true;
    assert.equal((await post({email:'admin@test',maintainer_ids:[identity(d,'Owner')],revision:detail.revision})).status,200);
    assert.equal((await (await get()).json()).linked_ids.length,1);
    assert.equal((await post({email:'admin@test',maintainer_ids:[],revision:detail.revision})).status,409);
  }finally{d.close();}
});
