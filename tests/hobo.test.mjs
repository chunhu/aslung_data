import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {ensureHoboSchema,saveHoboLogger,saveHoboBatch,queueHoboSync,retryHoboSync,runHoboSync,fetchHoboWindow,queryHobo,hoboCsvStream,hoboStatus,HoboError} from '../lib/hobo.mjs';
const start='2026-10-01T00:00:00.000Z',end='2026-10-03T00:00:00.000Z';
const observation=(timestamp=start,value=0)=>({logger_sn:'12345678',sensor_sn:'sensor-1',timestamp,data_type:'Temperature',data_type_id:'1',value,unit:'°C',sensor_measurement_type:'Temperature'});
function store(){const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON');ensureHoboSchema(d);saveHoboLogger(d,{serial:'12345678',name:'HOBO test',start,enabled:false});return d;}
const json=body=>Response.json(body);

test('LI-COR request uses only official endpoint, server bearer token, serial and UTC dates; keeps zeros and timestamp precision',async()=>{
  const rows=await fetchHoboWindow({serial:'12345678',start,end,token:'TEST_SECRET',fetchImpl:async(url,options)=>{
    assert.equal(url.origin,'https://api.licor.cloud');assert.equal(url.pathname,'/v1/data');
    assert.equal(url.searchParams.get('loggers'),'12345678');assert.equal(url.searchParams.get('start_date_time'),'2026-10-01 00:00:00');
    assert.equal(options.headers.Authorization,'Bearer TEST_SECRET');assert.equal(options.redirect,'error');assert.ok(options.signal);
    assert.ok(!url.href.includes('TEST_SECRET'));
    return json({max_results:false,data:[observation('2026-10-01 00:00:00.123')]});
  }});
  assert.equal(rows[0].value,0);assert.equal(rows[0].timestamp,'2026-10-01T00:00:00.123Z');
});

test('saturated API response is split; truncated parent data is discarded',async()=>{
  let calls=0;
  const rows=await fetchHoboWindow({serial:'12345678',start,end:'2026-10-01T00:00:04Z',token:'test',fetchImpl:async url=>{
    calls++;if(calls===1)return json({max_results:true,data:[observation(start,999)]});
    return json({max_results:false,data:[observation(url.searchParams.get('start_date_time'),calls)]});
  }});
  assert.equal(calls,3);assert.deepEqual(rows.map(r=>r.value),[2,3]);
  await assert.rejects(fetchHoboWindow({serial:'12345678',start,end:start,token:'test',fetchImpl:async()=>json({max_results:true,data:[]})}),/單秒/);
});

test('accepts actual LI-COR UTC timestamps containing a space before the time and a trailing Z',async()=>{
  const rows=await fetchHoboWindow({serial:'12345678',start,end,token:'test',fetchImpl:async()=>json({max_results:false,data:[observation('2026-10-01 00:00:00Z',31.331437719797968)]})});
  assert.equal(rows[0].timestamp,start);assert.equal(rows[0].value,31.331437719797968);
});

test('24-device batch uses Taiwan start date, deduplicates input and skips already queued work',()=>{
  const d=new DatabaseSync(':memory:');const preset=JSON.parse(readFileSync(new URL('../lib/hobo-rcec-loggers.json',import.meta.url),'utf8'));
  assert.equal(new Set(preset.serials).size,24);
  const range={serials:[...preset.serials,preset.serials[0]],start:'2025-01-01T00:00:00+08:00',end,enabled:false,queue:true,actor:'admin'};
  assert.deepEqual(saveHoboBatch(d,range),{saved:24,queued:24,skipped:0});
  assert.equal(d.prepare('SELECT DISTINCT start FROM hobo_jobs').get().start,'2024-12-31T16:00:00.000Z');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_loggers WHERE enabled=0').get().n,24);
  assert.deepEqual(saveHoboBatch(d,range),{saved:24,queued:0,skipped:24});
  assert.throws(()=>saveHoboBatch(d,{...range,serials:['55555555','not-a-serial']}),/序號/);
  assert.equal(d.prepare("SELECT COUNT(*) n FROM hobo_loggers WHERE serial='55555555'").get().n,0);
  d.close();
});

test('daily checkpoints give other queued loggers a turn before a long backfill continues',async()=>{
  const d=store();saveHoboBatch(d,{serials:['12345678','23456789'],start,end,enabled:false,queue:true,actor:'test'});
  const seen=[];const fetcher=async r=>{seen.push(r.serial);return [];};
  await runHoboSync(d,fetcher,1000);await runHoboSync(d,fetcher,2000);await runHoboSync(d,fetcher,3000);
  assert.deepEqual(seen,['12345678','23456789','12345678']);d.close();
});

test('rejects foreign logger, malformed/incomplete responses, bad times and nonnumeric observations',async()=>{
  for(const body of [null,{data:[]},{max_results:false,data:[{...observation(),logger_sn:'999'}]},{max_results:false,data:[observation('bad time')]},{max_results:false,data:[observation(start,'12')]}]){
    await assert.rejects(fetchHoboWindow({serial:'12345678',start,end,token:'test',fetchImpl:async()=>json(body)}),HoboError);
  }
  await assert.rejects(fetchHoboWindow({serial:'../bad',start,end,token:'test',fetchImpl:()=>assert.fail()}),/序號/);
});

test('upstream authentication, rate limits and network failures expose no token or upstream body',async()=>{
  for(const status of [401,403,429,509])await assert.rejects(fetchHoboWindow({serial:'12345678',start,end,token:'TEST_SECRET',fetchImpl:async()=>new Response('TEST_SECRET',{status})}),e=>!e.message.includes('TEST_SECRET')&&e.status===(status===429||status===509?429:502));
  await assert.rejects(fetchHoboWindow({serial:'12345678',start,end,token:'TEST_SECRET',fetchImpl:async()=>{throw new Error('TEST_SECRET');}}),e=>!e.message.includes('TEST_SECRET'));
});

test('worker checkpoints one day at a time, deduplicates overlap, and repeats update existing measurements',async()=>{
  const d=store();const id=queueHoboSync(d,{serial:'12345678',start,end,actor:'admin'});let ranges=[];
  const fetcher=async r=>{ranges.push(r);return [observation(r.start),observation(r.end,1)];};
  assert.equal((await runHoboSync(d,fetcher)).status,'QUEUED');
  assert.equal(d.prepare('SELECT cursor FROM hobo_jobs WHERE id=?').get(id).cursor,'2026-10-02T00:00:00.000Z');
  assert.equal((await runHoboSync(d,fetcher)).status,'DONE');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,3);
  assert.equal(d.prepare('SELECT synced_until FROM hobo_loggers').get().synced_until,end);
  queueHoboSync(d,{serial:'12345678',start,end:start});await runHoboSync(d,async()=>[observation(start,9)]);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,3);
  assert.equal(queryHobo(d,{serial:'12345678',start,end}).rows[0].value,9);
  assert.equal(ranges.length,2);d.close();
});

test('later manual history does not advance automatic cursor over an unimported gap',async()=>{
  const d=store();queueHoboSync(d,{serial:'12345678',start:end,end});await runHoboSync(d,async()=>[]);
  assert.equal(d.prepare('SELECT synced_until FROM hobo_loggers').get().synced_until,null);d.close();
});

test('worker retries failures without progressing, locks parallel workers, and resumes a failed job explicitly',async()=>{
  const d=store();const id=queueHoboSync(d,{serial:'12345678',start,end});let release;
  const running=runHoboSync(d,()=>new Promise(resolve=>{release=resolve;}),1000);
  assert.equal(await runHoboSync(d,async()=>assert.fail(),1001),null);release([]);await running;
  let now=1000000;
  for(let i=0;i<3;i++){await runHoboSync(d,async()=>{throw new HoboError(502,'temporary');},now);now+=1000000;}
  const failed=d.prepare('SELECT * FROM hobo_jobs WHERE id=?').get(id);assert.equal(failed.status,'FAILED');assert.equal(failed.cursor,'2026-10-02T00:00:00.000Z');
  retryHoboSync(d,id);assert.equal((await runHoboSync(d,async()=>[],now)).status,'DONE');d.close();
});

test('schedule is opt-in, starts at configured time, catches up and overlaps last day hourly',async()=>{
  const d=store(),now=Date.parse('2026-10-03T00:00:00Z');
  assert.equal(await runHoboSync(d,async()=>[],now),null);
  saveHoboLogger(d,{serial:'12345678',name:'scheduled',start,enabled:true});
  await runHoboSync(d,async()=>[],now);await runHoboSync(d,async()=>[],now);
  assert.equal(d.prepare('SELECT synced_until FROM hobo_loggers').get().synced_until,end);
  assert.equal(await runHoboSync(d,async()=>[],now+1000),null);
  let requested;await runHoboSync(d,async r=>{requested=r;return [];},now+3600000);
  assert.equal(requested.start,'2026-10-02T00:00:00.000Z');d.close();
});

test('CSV exports whole selected range, original units, safe text and numeric negatives; queries paginate',async()=>{
  const d=store();queueHoboSync(d,{serial:'12345678',start,end:start});
  await runHoboSync(d,async()=>[{...observation(start,-2),data_type:'=FORMULA',sensor_sn:'a,"b'},{...observation(start,0),sensor_sn:'other'}]);
  const first=queryHobo(d,{serial:'12345678',start,end,limit:1});assert.ok(first.next);assert.equal(queryHobo(d,{serial:'12345678',start,end,after:first.next}).rows.length,1);
  const csv=await new Response(hoboCsvStream(d,{serial:'12345678',start,end})).text();
  assert.match(csv,/'=FORMULA/);assert.match(csv,/-2/);assert.match(csv,/°C/);assert.match(csv,/"a,""b"/);assert.equal(csv.trim().split('\r\n').length,3);
  assert.equal(JSON.stringify(hoboStatus(d)).includes('TEST_SECRET'),false);d.close();
});

test('HOBO API rejects non-admin read/write/download, enforces origin, and exports valid CSV for admin',async()=>{
  const d=store();let role='member',origin=true;
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const hobo=await import('../lib/hobo.mjs');
  const storage=await import('../lib/hobo-storage.mjs');
  const deps={'@/lib/server':{identity:async()=>({role,email:'test'}),AppError,writeGuard:()=>{if(!origin)throw new AppError(403,'origin');},fail:e=>Response.json({error:e.message},{status:e.status||500})},'@/lib/store.mjs':{getConnection:()=>d},'@/lib/hobo.mjs':hobo,'@/lib/hobo-storage.mjs':storage};
  const source=readFileSync(new URL('../app/api/hobo/route.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','exports','module',code)(name=>{assert.ok(name in deps);return deps[name];},module.exports,module);
  const {GET,POST}=module.exports;const params=new URLSearchParams({action:'csv',serial:'12345678',start,end});
  assert.equal((await GET(new Request('http://local/api/hobo?'+params))).status,403);
  assert.equal((await POST(new Request('http://local/api/hobo',{method:'POST',body:JSON.stringify({action:'save'})}))).status,403);
  role='admin';origin=false;assert.equal((await POST(new Request('http://local/api/hobo',{method:'POST'}))).status,403);
  const response=await GET(new Request('http://local/api/hobo?'+params));assert.equal(response.status,200);assert.match(response.headers.get('Content-Disposition'),/HOBO_12345678_20261001_20261003/);assert.match(await response.text(),/logger_sn/);
  d.close();
});
