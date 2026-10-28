// Run after pnpm build. No production data or MySQL connection is used.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve('.'),dir=mkdtempSync(join(tmpdir(),'aslung-workspace-http-'));
process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {getConnection}=await import('../lib/store.mjs');
const d=getConnection(),cookies=new Map();
const {ensureHoboSchema,saveHoboLogger,hoboRevision}=await import('../lib/hobo.mjs');
ensureHoboSchema(d);saveHoboLogger(d,{serial:'20720755',name:'Pagination fixture',start:'2026-10-01T00:00:00.000Z',enabled:false});
const insertHobo=d.prepare('INSERT INTO hobo_observations VALUES(?,?,?,?,?,?,?,?)');
for(let i=0;i<230;i++)insertHobo.run('20720755','sensor-'+i,'2026-10-01T00:00:00.000Z','CURRENT','1',i,'°C','Temperature');
for(const role of ['admin','member','viewer','device_manager','calibration_manager']){
  const email=role+'@test.invalid',token=randomBytes(32).toString('hex');
  d.prepare('INSERT INTO members(email,user_id,name,role,active,password_hash) VALUES(?,?,?,?,1,?)').run(email,randomUUID(),role,role,'unused');
  d.prepare('INSERT INTO sessions(token_hash,email,expires_at) VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),email,Date.now()+60000);
  cookies.set(role,'aslung_session='+token);
}
for(let i=0;i<100;i++){
  const id='AL-'+i;d.prepare("INSERT INTO devices(id,name,status) VALUES(?,?,'STANDBY')").run(id,id);
  d.prepare("INSERT INTO device_locations(aslung_id,lab_id,start_time,active) VALUES(?,'LAB','2020-01-01T00:00:00Z',1)").run(id);
}
d.prepare("INSERT INTO grants(grant_type,device_id,email,start) VALUES('device','AL-0','member@test.invalid','2020-01-01T00:00:00Z')").run();
const standalone=join(root,'.next/standalone');
for(const [target,source] of [['public','public'],['.next/static','.next/static']])if(!existsSync(join(standalone,target)))symlinkSync(join(root,source),join(standalone,target),'dir');
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[join(standalone,'server.js')],{cwd:standalone,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:base},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
const request=(path,role)=>fetch(base+path,{headers:role?{Cookie:cookies.get(role)}:{}});
try{
  let ready=false;
  for(let i=0;i<100;i++){try{if((await request('/api/health')).ok){ready=true;break;}}catch{}await delay(100);}
  assert.ok(ready,'Server did not start: '+logs);
  assert.equal((await request('/api/manage?scope=news')).status,401);
  let fullBytes,newsBytes;
  for(const scope of ['full','news','members','data','files','connection']){
    const response=await request('/api/manage?scope='+scope,'admin');assert.equal(response.status,200,scope);
    const text=await response.text(),body=JSON.parse(text);assert.equal(body.scope,scope);
    if(scope==='full'){fullBytes=text.length;assert.equal(body.devices.length,100);}
    if(scope==='news'){
      newsBytes=text.length;assert.deepEqual(body.devices,[]);assert.deepEqual(body.members,[]);assert.deepEqual(body.locations,[]);
      assert.equal(body.summary.devices,100);
    }
    if(scope==='members')assert.equal(body.members.length,5);
    if(scope==='data'){assert.equal(body.devices.length,100);assert.deepEqual(body.members,[]);assert.ok(body.downloadSegments.length);}
  }
  assert.ok(newsBytes<fullBytes*0.15);
  for(const role of ['member','viewer','device_manager','calibration_manager'])for(const scope of ['news','members','permissions','full']){
    const response=await request('/api/manage?scope='+scope,role);assert.equal(response.status,200);
    const body=await response.json();assert.deepEqual(body.members,[]);assert.deepEqual(body.grants,[]);assert.equal(body.summary,null);
    assert.ok(body.devices.every(row=>role==='member'&&row.id==='AL-0'));
  }
  const setCache=(role,seconds)=>fetch(base+'/api/manage',{method:'POST',headers:{Cookie:cookies.get(role),Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action:'realtimeCacheUpdate',seconds})});
  const initial=await (await request('/api/manage?scope=realtime','admin')).json();assert.equal(initial.alertSettings.realtime_cache_secs,120);
  for(const role of ['member','viewer','device_manager','calibration_manager'])assert.equal((await setCache(role,300)).status,403);
  for(const seconds of [-1,3601,1.5,'120',null])assert.equal((await setCache('admin',seconds)).status,400);
  for(const seconds of [0,3600,45]){
    assert.equal((await setCache('admin',seconds)).status,200);
    const saved=await (await request('/api/manage?scope=realtime','admin')).json();assert.equal(saved.alertSettings.realtime_cache_secs,seconds);
    assert.equal(d.prepare('SELECT realtime_cache_secs FROM alert_settings WHERE id=1').get().realtime_cache_secs,seconds);
  }
  assert.equal((await setCache('admin',120)).status,200);
  const hoboQuery='/api/hobo?action=query&serial=20720755&start=2026-10-01T00:00:00.000Z&end=2026-10-02T00:00:00.000Z';
  const page1=await (await request(hoboQuery,'admin')).json();assert.equal(page1.rows.length,200);assert.ok(page1.next_cursor);
  const continuation=hoboQuery+'&cursor='+encodeURIComponent(page1.next_cursor);
  for(const role of ['member','viewer','device_manager','calibration_manager'])assert.equal((await request(continuation,role)).status,403);
  const response2=await request(continuation,'admin');assert.equal(response2.headers.get('cache-control'),'no-store');
  const page2=await response2.json();assert.equal(page2.rows.length,30);assert.equal(page2.next_cursor,null);
  assert.equal(new Set([...page1.rows,...page2.rows].map(row=>row.sensor_sn)).size,230);
  assert.equal((await request(continuation+'&sensor=other','admin')).status,400);
  hoboRevision(d,'20720755');assert.equal((await request(continuation,'admin')).status,409);
  assert.equal((await request('/api/manage?scope=invalid','admin')).status,400);
  assert.equal(d.prepare("SELECT status FROM devices WHERE id='AL-0'").get().status,'STANDBY','Read requests must not update devices');
  const allowed=await (await request('/api/manage?scope=data','member')).json();assert.equal(allowed.downloadSegments.length,1);
  d.prepare("DELETE FROM grants WHERE email='member@test.invalid'").run();
  const revoked=await (await request('/api/manage?scope=data','member')).json();assert.deepEqual(revoked.downloadSegments,[]);
  assert.deepEqual(await (await request('/api/realtime','member')).json(),[]);
  d.prepare("UPDATE members SET active=0 WHERE email='member@test.invalid'").run();
  assert.equal((await request('/api/manage?scope=news','member')).status,401);
  console.log(`PASS: standalone page scopes, 5 roles, admin cache settings, HOBO cursor pagination, revocation, disabled sessions, read-only initialization; payload full=${fullBytes}, news=${newsBytes} bytes.`);
}finally{
  child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));
  d.close();rmSync(dir,{recursive:true,force:true});
}
