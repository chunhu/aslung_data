import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ts from 'typescript';
import {createRealtimeReader,latestRealtimeReadings} from '../lib/realtime-readings.mjs';
import {buildDownloadSegments} from '../lib/download-segments.mjs';
import * as realtimeSettings from '../lib/realtime-settings.mjs';

function load(file,deps){
  const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);
  return module.exports;
}
test('120 devices require three bounded round trips; concurrent requests share work and measurements expire',async()=>{
  let time=0,running=0,peak=0,calls=0;
  const pool={query:async({sql,values,timeout})=>{
    const ids=values.filter((_,i)=>i%2===0);
    calls++;running++;peak=Math.max(peak,running);
    assert.equal(timeout,10000);assert.ok(ids.length<=50);
    assert.equal((sql.match(/LIMIT 1/g)||[]).length,ids.length);
    assert.match(sql,/ORDER BY time DESC, id DESC/);
    await new Promise(r=>setTimeout(r,5));running--;
    return [ids.map(id=>({_realtime_id:id,aslung_id:id,time:'2026-10-01 00:00:00',battery:0}))];
  }};
  const read=createRealtimeReader({now:()=>time}),ids=Array.from({length:120},(_,i)=>'A'+i);
  const [first,second]=await Promise.all([read(pool,ids),read(pool,ids)]);
  assert.equal(first.length,120);assert.deepEqual(second,first);assert.equal(calls,3);assert.equal(peak,2);
  await read(pool,ids);assert.equal(calls,3);
  time=119999;await read(pool,ids);assert.equal(calls,3);
  time=120000;await read(pool,ids);assert.equal(calls,6);
  await read(pool,ids,{refresh:true});assert.equal(calls,9);
});
test('empty results are cached briefly, errors are retried and caches have a capacity bound',async()=>{
  let calls=0,fails=false;
  const pool={query:async({values})=>{calls++;if(fails)throw Error('offline');return [values.filter(id=>id!=='empty').map(id=>({aslung_id:id}))];}};
  const read=createRealtimeReader({maxEntries:2});
  assert.deepEqual(await read(pool,['empty']),[]);await read(pool,['empty']);assert.equal(calls,1);
  fails=true;assert.deepEqual(await read(pool,['A']),[]);assert.equal(calls,2);
  fails=false;assert.equal((await read(pool,['A'])).length,1);assert.equal(calls,3);
  await read(pool,['B']);await read(pool,['empty']);assert.equal(calls,5);
});
test('batch cache keys preserve requested IDs when the MySQL collation returns another casing',async()=>{
  const read=createRealtimeReader();
  const pool={query:async({values})=>[[{_realtime_id:values[0],aslung_id:'AL-1',time:'2026-10-01 00:00:00'}]]};
  const rows=await read(pool,['al-1']);assert.equal(rows.length,1);assert.equal(rows[0].aslung_id,'AL-1');
});

const dir=mkdtempSync(join(tmpdir(),'aslung-workspace-perf-'));
const original=process.env.DATABASE_PATH;process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {getConnection,getStore}=await import('../lib/store.mjs');
const d=getConnection();
after(()=>{d.close();if(original===undefined)delete process.env.DATABASE_PATH;else process.env.DATABASE_PATH=original;rmSync(dir,{recursive:true,force:true});});
for(const role of ['admin','member','viewer','device_manager','calibration_manager']){
  d.prepare('INSERT INTO members(email,user_id,name,role,active,password_hash) VALUES(?,?,?,?,1,?)').run(role+'@test',role,role,role,'unused');
}
d.prepare("INSERT INTO labs(id,created_at) VALUES('LAB','2020-01-01')").run();
for(let i=0;i<100;i++){
  const id='AL-'+i;
  d.prepare("INSERT INTO devices(id,name,status) VALUES(?,?,'STANDBY')").run(id,id);
  d.prepare("INSERT INTO device_locations(aslung_id,lab_id,start_time,active) VALUES(?,'LAB','2020-01-01T00:00:00Z',1)").run(id);
  d.prepare("INSERT INTO alert_logs(aslung_id,offline_mins,created_at) VALUES(?,60,'2026-10-01')").run(id);
}
d.prepare("INSERT INTO grants(grant_type,device_id,email,start) VALUES('device','AL-0','member@test','2020-01-01T00:00:00Z')").run();
d.prepare("INSERT INTO maintainers(name,email,created_at) VALUES('Member maintainer','member@test','2020-01-01')").run();
class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
let actor={role:'admin',email:'admin@test',name:'admin',allowMaintainerNameMatch:false},sqlCalls=[],segmentReads=0;
const store={prepare(sql){sqlCalls.push(sql);return getStore().prepare(sql);}};
const server={writeGuard:()=>{},identity:async()=>({...actor}),db:()=>store,AppError,fail:e=>Response.json({error:e.message},{status:e.status||500}),
  config:()=>({url:'test',token:'test'}),getSiteStats:()=>({totalViews:0,todayViews:0}),
  syncDeviceStatusesAndLocations:()=>assert.fail('GET must not rewrite device status'),
  downloadSegments:async me=>{
    segmentReads++;
    return buildDownloadSegments(me,d.prepare('SELECT * FROM devices').all(),d.prepare('SELECT * FROM device_locations').all(),d.prepare('SELECT * FROM grants WHERE email=?').all(me.email),d.prepare('SELECT name,email FROM maintainers WHERE email=?').all(me.email));
  }};
const manage=load('../app/api/manage/route.ts',{
  '@/lib/server':server,'@/lib/store.mjs':{getConnection:()=>d},'@/lib/registration.mjs':{RegistrationError:class extends Error{}},'@/lib/registration-mail':{},
  '@/lib/realtime-settings.mjs':realtimeSettings,'@/lib/passwords.mjs':{},'node:crypto':{},
});
const get=async scope=>{
  sqlCalls=[];segmentReads=0;
  const response=await manage.GET(new Request('http://test/api/manage'+(scope?'?scope='+scope:'')));
  assert.equal(response.status,200);return response.json();
};
test('initial feeds skip unrelated tables and downloads; page reads never update device status',async()=>{
  actor={...actor,role:'admin',email:'admin@test'};
  const full=await get();const fullBytes=JSON.stringify(full).length;
  assert.equal(full.devices.length,100);assert.equal(full.alertLogs.length,100);
  const news=await get('news');
  for(const key of ['devices','locations','members','grants','files','fileGrants','alertLogs','alertChecks','tokens','downloadSegments'])assert.deepEqual(news[key],[],key);
  assert.equal(segmentReads,0);assert.equal(news.summary.devices,100);
  assert.ok(!sqlCalls.some(sql=>/SELECT \* FROM (devices|device_locations|alert_logs|files|grants)\b/.test(sql)));
  assert.ok(!sqlCalls.some(sql=>/^\s*(UPDATE|INSERT|DELETE)/.test(sql)));
  assert.equal(d.prepare("SELECT status FROM devices WHERE id='AL-0'").get().status,'STANDBY');
  const ratio=JSON.stringify(news).length/fullBytes;
  assert.ok(ratio<0.15,`Bootstrap payload ratio: ${ratio}`);
  console.log(`Fixture payload: full ${fullBytes} bytes, news ${JSON.stringify(news).length} bytes`);
});
test('each page loads required editors and datasets without loading unrelated administration',async()=>{
  const data=await get('data');assert.equal(data.devices.length,100);assert.ok(data.downloadSegments.length>0);assert.equal(data.members.length,0);assert.equal(data.alertLogs.length,0);
  const files=await get('files');assert.equal(files.members.length,5);assert.equal(files.devices.length,0);assert.equal(files.tokens.length,0);
  const members=await get('members');assert.equal(members.members.length,5);assert.equal(members.devices.length,100);assert.equal(members.alertLogs.length,0);
  const alerts=await get('alerts');assert.equal(alerts.alertLogs.length,100);assert.equal(alerts.members.length,0);
  const invalid=await manage.GET(new Request('http://test/api/manage?scope=secret'));assert.equal(invalid.status,400);
});
test('scoped reads preserve member filtering and maintainer navigation without exposing admin collections',async()=>{
  actor={role:'member',email:'member@test',name:'member',allowMaintainerNameMatch:false};
  const news=await get('news');assert.equal(news.isMaintainer,true);assert.deepEqual(news.devices,[]);
  const full=await get('full');assert.deepEqual(full.devices.map(row=>row.id),['AL-0']);assert.deepEqual(full.members,[]);assert.deepEqual(full.grants,[]);
  assert.ok(full.locations.every(row=>row.aslung_id==='AL-0'));assert.equal(full.summary,null);
});
test('cached realtime readings reauthorize on each request and again after I/O',async()=>{
  let role='member',allow=true,queries=0,revokeDuringQuery=false;
  const realtimeStore={prepare(sql){return {bind(){return this;},async first(){return {realtime_cache_secs:120};},async all(){
    if(sql.includes('SELECT id FROM devices'))return {results:[{id:'AL-0'},{id:'AL-1'}]};
    if(sql.includes('SELECT device_id FROM grants'))return {results:allow?[{device_id:'AL-0'}]:[]};
    return {results:[]};
  }}}};
  const pool={query:async({values})=>{queries++;if(revokeDuringQuery)allow=false;return [values.map(id=>({aslung_id:id,time:'2026-10-01 00:00:00',battery:0}))];}};
  const route=load('../app/api/realtime/route.ts',{
    '@/lib/server':{...server,identity:async()=>({role,email:'member@test'}),db:()=>realtimeStore},
    '@/lib/realtime-settings.mjs':realtimeSettings,'@/lib/data':{getPool:()=>pool},'@/lib/realtime-readings.mjs':{latestRealtimeReadings},
  });
  const call=q=>route.GET(new Request('http://test/api/realtime'+(q||'')));
  assert.deepEqual((await (await call()).json()).map(row=>row.aslung_id),['AL-0']);assert.equal(queries,1);
  role='admin';assert.equal((await (await call()).json()).length,2);assert.equal(queries,2);
  role='member';assert.equal((await (await call()).json()).length,1);assert.equal(queries,2);
  allow=false;assert.deepEqual(await (await call()).json(),[]);assert.equal(queries,2);
  allow=true;revokeDuringQuery=true;assert.deepEqual(await (await call('?refresh=1')).json(),[]);assert.equal(queries,3);
});

test('cache duration changes use measurement age immediately, including disabling and pending deduplication',async()=>{
  let time=0,calls=0;const read=createRealtimeReader({now:()=>time});
  const pool={query:async()=>{calls++;return [[{aslung_id:'A'}]];}};
  await read(pool,['A']);time=10000;
  await read(pool,['A'],{ttlMs:20000});assert.equal(calls,1);
  await read(pool,['A'],{ttlMs:5000});assert.equal(calls,2);
  time=15000;await read(pool,['A'],{ttlMs:20000});assert.equal(calls,2);
  await read(pool,['A'],{ttlMs:0});await read(pool,['A'],{ttlMs:0});assert.equal(calls,4);
  await Promise.all([read(pool,['A'],{ttlMs:0}),read(pool,['A'],{ttlMs:0})]);assert.equal(calls,5);
});
test('only admin can persist an integer cache duration and unrelated settings remain intact',async()=>{
  const post=seconds=>manage.POST(new Request('http://test/api/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'realtimeCacheUpdate',seconds})}));
  for(const role of ['member','viewer','device_manager','calibration_manager']){actor={...actor,role};assert.equal((await post(300)).status,403);}
  actor={...actor,role:'admin'};
  for(const value of [-1,3601,1.5,'120',null])assert.equal((await post(value)).status,400);
  for(const value of [0,3600,45,120]){
    assert.equal((await post(value)).status,200);
    assert.equal(d.prepare('SELECT realtime_cache_secs FROM alert_settings WHERE id=1').get().realtime_cache_secs,value);
    assert.equal((await get('realtime')).alertSettings.realtime_cache_secs,value);
  }
  assert.equal(d.prepare('SELECT realtime_interval_secs FROM alert_settings WHERE id=1').get().realtime_interval_secs,60);
});
