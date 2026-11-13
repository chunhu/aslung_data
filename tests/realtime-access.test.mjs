import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {currentRealtimeGrants,canReadRealtime} from '../lib/realtime-access.mjs';
import {latestRealtimeReadings} from '../lib/realtime-readings.mjs';
import {normalizeRealtimeCacheSeconds} from '../lib/realtime-settings.mjs';
const now=Date.parse('2026-11-13T08:00:00Z'),member={role:'member',email:'research@test',name:'Owner',allowMaintainerNameMatch:true};
function fixture(){
  const d=new DatabaseSync(':memory:');d.exec(`
    CREATE TABLE devices(id TEXT PRIMARY KEY,location TEXT,status TEXT);
    CREATE TABLE grants(email TEXT,grant_type TEXT,device_id TEXT,lab_id TEXT,start TEXT,end TEXT);
    CREATE TABLE device_locations(id INTEGER PRIMARY KEY,aslung_id TEXT,lab_id TEXT,start_time TEXT,end_time TEXT,active INTEGER);
    INSERT INTO devices VALUES('DIRECT','','DEPLOYED'),('EXPIRED','','DEPLOYED'),('FUTURE','','DEPLOYED'),('MAINTAINED','','DEPLOYED'),('LAB','L1','DEPLOYED'),('MOVED','L1','DEPLOYED'),('LEGACY','L1','DEPLOYED'),('STALE','L1','DEPLOYED'),('ENDED','L1','DEPLOYED');
    INSERT INTO grants VALUES('research@test','device','DIRECT',NULL,'2026-11-01','2026-11-30'),('research@test','device','EXPIRED',NULL,'2026-01-01','2026-11-01'),('research@test','device','FUTURE',NULL,'2026-12-01',NULL),('research@test','lab',NULL,'L1','2026-11-01',NULL),('other@test','device','MAINTAINED',NULL,'2020-01-01',NULL);
    INSERT INTO device_locations VALUES(1,'LAB','L1','2026-11-02',NULL,1),(2,'MOVED','L1','2026-10-01',NULL,1),(3,'MOVED','L2','2026-11-10',NULL,1),(4,'STALE','L1','2026-10-01',NULL,1),(5,'STALE','L1','2026-11-05','2026-11-06',0),(6,'ENDED','L1','2026-10-01','2026-11-13T08:00:00Z',1);`);
  const read=(sql,args)=>d.prepare(sql).all(...args);return {d,read};
}
test('research realtime scope includes only current explicit device/site grants and current deployments',async()=>{
  const {d,read}=fixture();try{
    const access=await currentRealtimeGrants(read,member,now);assert.deepEqual([...access.keys()].sort(),['DIRECT','LAB','LEGACY']);
    assert.equal(canReadRealtime(access,'DIRECT',Date.parse('2026-11-05T00:00:00Z')),true);
    assert.equal(canReadRealtime(access,'DIRECT',Date.parse('2026-10-01T00:00:00Z')),false);
    assert.equal(canReadRealtime(access,'LAB',Date.parse('2026-11-01T00:00:00Z')),false);
    assert.equal(canReadRealtime(access,'MAINTAINED',now),false);
    assert.deepEqual([...await currentRealtimeGrants(read,{...member,email:'no-grants@test'},now)],[]);
  }finally{d.close();}
});
test('grant timestamps use instants, including Taiwan dates and equivalent timezone offsets',async()=>{
  const {d,read}=fixture();try{
    d.exec('DELETE FROM grants');
    const insert=d.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?)');
    insert.run(member.email,'device','DIRECT',null,'2026-11-13T15:00:00+08:00','2026-11-13T17:00:00+08:00');
    insert.run(member.email,'device','EXPIRED',null,'2026-11-13T10:00:00+08:00','2026-11-13T15:59:59+08:00');
    insert.run(member.email,'device','FUTURE',null,'2026-11-13T16:00:01+08:00',null);
    insert.run(member.email,'device','STALE',null,'bad date',null);
    assert.deepEqual([...await currentRealtimeGrants(read,member,now)].map(([id])=>id),['DIRECT']);
  }finally{d.close();}
});
function compile(deps){
  const code=ts.transpileModule(readFileSync(new URL('../app/api/realtime/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);return module.exports;
}
test('an administrator-warmed shared cache never expands a research member scope; revocation applies immediately',async()=>{
  const {d,read}=fixture();let role='admin',queries=0,revoke=false,disabled=false;
  const store={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async all(){return {results:read(sql,args)};},async first(){return {realtime_cache_secs:120};}};}};
  const pool={query:async({values})=>{
    queries++;if(revoke)d.prepare('DELETE FROM grants WHERE email=?').run(member.email);
    return [values.filter((_,index)=>index%2===0).map(id=>({_realtime_id:id,aslung_id:id,time:new Date(now)}))];
  }};
  const api=compile({
    '@/lib/server':{db:()=>store,identity:async()=>{if(disabled)throw Object.assign(new Error('disabled'),{status:403});return {...member,role};},fail:error=>Response.json({error:error.message},{status:error.status||500})},
    '@/lib/realtime-access.mjs':{currentRealtimeGrants:(read,actor)=>currentRealtimeGrants(read,actor,now),canReadRealtime,grantOnlyRealtime:actor=>['member','viewer'].includes(actor.role)},
    '@/lib/realtime-readings.mjs':{latestRealtimeReadings},'@/lib/realtime-settings.mjs':{normalizeRealtimeCacheSeconds},'@/lib/data':{getPool:()=>pool},
  });
  const call=(suffix='')=>api.GET(new Request('http://test/api/realtime'+suffix));
  try{
    assert.equal((await (await call()).json()).length,9);assert.equal(queries,1);
    role='member';assert.deepEqual((await (await call()).json()).map(row=>row.aslung_id).sort(),['DIRECT','LAB','LEGACY']);assert.equal(queries,1);
    assert.equal((await call('?extra_ids=MAINTAINED')).status,403);
    role='viewer';assert.deepEqual((await (await call()).json()).map(row=>row.aslung_id).sort(),['DIRECT','LAB','LEGACY']);
    role='member';revoke=true;assert.deepEqual(await (await call('?refresh=1')).json(),[]);assert.equal(queries,2);
    assert.deepEqual(await (await call()).json(),[]);assert.equal(queries,2);
    disabled=true;assert.equal((await call()).status,403);
  }finally{d.close();}
});
