import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {ensureHoboSchema,saveHoboLogger,saveHoboBatch,queueHoboSync,retryHoboSync,cancelHoboSync,manageHoboJobs,runHoboSync,fetchHoboWindow,queryHobo,hoboCsvStream,hoboStatus,HoboError,hoboMonthRanges,waitHoboRequest} from '../lib/hobo.mjs';
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
  let calls=0,permissions=0;
  const rows=await fetchHoboWindow({serial:'12345678',start,end:'2026-10-01T00:00:04Z',token:'test',beforeRequest:async()=>{permissions++;},fetchImpl:async url=>{
    calls++;assert.equal(permissions,calls);if(calls===1)return json({max_results:true,data:[observation(start,999)]});
    return json({max_results:false,data:[observation(url.searchParams.get('start_date_time'),calls)]});
  }});
  assert.equal(calls,3);assert.deepEqual(rows.map(r=>r.value),[2,3]);
  await assert.rejects(fetchHoboWindow({serial:'12345678',start,end:start,token:'test',fetchImpl:async()=>json({max_results:true,data:[]})}),/單秒/);
});

test('long history is split by Taiwan calendar month across year and leap-day boundaries without gaps',()=>{
  const ranges=hoboMonthRanges('2024-01-15T00:00:00+08:00','2025-03-12T10:00:00+08:00');
  assert.equal(ranges.length,15);assert.equal(ranges[0].end,'2024-01-31T16:00:00.000Z');
  assert.equal((Date.parse(ranges[1].end)-Date.parse(ranges[1].start))/86400000,29);
  assert.equal(ranges.at(-1).end,'2025-03-12T02:00:00.000Z');
  for(let i=1;i<ranges.length;i++)assert.equal(ranges[i].start,ranges[i-1].end);
});

test('month boundary limits daily request and pauses the job before continuing into next month',async()=>{
  const d=store(),now=Date.now(),a='2026-01-31T15:00:00.000Z',b='2026-01-31T18:00:00.000Z';
  const id=queueHoboSync(d,{serial:'12345678',start:a,end:b}),seen=[];
  const fetcher=async r=>{seen.push({start:r.start,end:r.end});return [];};
  await runHoboSync(d,fetcher,now);
  const pending=d.prepare('SELECT * FROM hobo_jobs WHERE id=?').get(id);
  assert.equal(pending.cursor,'2026-01-31T16:00:00.000Z');assert.ok(pending.next_attempt>=now+60000);
  assert.equal(hoboStatus(d).jobs[0].months_done,1);assert.equal(hoboStatus(d).jobs[0].months,2);
  assert.equal(await runHoboSync(d,fetcher,now+1),null);
  assert.equal((await runHoboSync(d,fetcher,pending.next_attempt+1)).status,'DONE');
  assert.deepEqual(seen,[{start:a,end:'2026-01-31T16:00:00.000Z'},{start:'2026-01-31T16:00:00.000Z',end:b}]);d.close();
});

test('older queued history gains month checkpoints while preserving its daily resume cursor',async()=>{
  const d=store(),a='2025-01-01T00:00:00+08:00',b='2026-03-01T00:00:00+08:00';
  const id=queueHoboSync(d,{serial:'12345678',start:a,end:b});d.prepare('DELETE FROM hobo_months WHERE job=?').run(id);
  d.prepare('UPDATE hobo_jobs SET cursor=? WHERE id=?').run('2025-02-15T00:00:00.000Z',id);
  let requested;await runHoboSync(d,async r=>{requested=r;return [];});
  assert.equal(requested.start,'2025-02-15T00:00:00.000Z');assert.equal(requested.end,'2025-02-16T00:00:00.000Z');
  const status=hoboStatus(d).jobs[0];assert.equal(status.months,14);assert.equal(status.months_done,1);d.close();
});

test('persisted request spacing is shared by new callers and applies before each split request',async()=>{
  const d=store();let time=1000;const sleeps=[];
  const options={clock:()=>time,sleep:async ms=>{sleeps.push(ms);time+=ms;},interval:15000};
  await waitHoboRequest(d,options);await waitHoboRequest(d,{...options});await waitHoboRequest(d,{...options});
  assert.deepEqual(sleeps,[15000,15000]);
  assert.equal(Number(d.prepare("SELECT value FROM hobo_service_state WHERE name='licor_next_request'").get().value),46000);d.close();
});

test('HTTP Retry-After seconds and date are preserved for server-requested cooldown',async()=>{
  const now=Date.now();
  for(const retry of ['900',new Date(now+1800000).toUTCString()]){
    await assert.rejects(fetchHoboWindow({serial:'12345678',start,end,token:'test',fetchImpl:async()=>new Response('',{status:429,headers:{'Retry-After':retry}})}),e=>e.status===429&&e.retryAt>=now+899000);
  }
});

test('rate limiting pauses all devices without exhausting the normal failure retry budget',async t=>{
  const d=store();queueHoboSync(d,{serial:'12345678',start,end});saveHoboLogger(d,{serial:'23456789',name:'other',start,enabled:false});queueHoboSync(d,{serial:'23456789',start,end});
  const previous=process.env.LICOR_API_TOKEN;process.env.LICOR_API_TOKEN='TEST_ONLY_TOKEN';let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'900'}});});
  try{
    const now=Date.now();await runHoboSync(d);assert.equal(calls,1);
    const job=d.prepare('SELECT * FROM hobo_jobs WHERE serial=?').get('12345678');
    assert.equal(job.attempts,0);assert.equal(job.status,'QUEUED');assert.equal(job.cursor,start);assert.ok(job.next_attempt>=now+900000);
    assert.equal(await runHoboSync(d),null);assert.equal(calls,1);
    assert.ok(hoboStatus(d).next_request>=job.next_attempt);
  }finally{if(previous===undefined)delete process.env.LICOR_API_TOKEN;else process.env.LICOR_API_TOKEN=previous;d.close();}
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

test('cancelling queued work preserves downloaded rows and progress and prevents schedule regeneration',async()=>{
  const d=store();const id=queueHoboSync(d,{serial:'12345678',start,end});
  await runHoboSync(d,async()=>[observation()]);saveHoboLogger(d,{serial:'12345678',name:'test',start,enabled:true});
  const cursor=d.prepare('SELECT cursor FROM hobo_jobs WHERE id=?').get(id).cursor;
  assert.equal(cancelHoboSync(d,id).ok,true);
  const job=d.prepare('SELECT * FROM hobo_jobs WHERE id=?').get(id);assert.equal(job.status,'CANCELLED');assert.equal(job.cursor,cursor);assert.equal(job.lease_token,'');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,1);assert.equal(d.prepare('SELECT enabled FROM hobo_loggers').get().enabled,0);
  assert.equal(d.prepare("SELECT COUNT(*) n FROM hobo_months WHERE job=? AND status='CANCELLED'").get(id).n,1);
  assert.equal(await runHoboSync(d,async()=>assert.fail('cancelled work must not fetch')),null);
  assert.throws(()=>retryHoboSync(d,id),/找不到/);
  // Repeating an old cancellation must not disable an intentionally restarted schedule.
  saveHoboLogger(d,{serial:'12345678',name:'test',start,enabled:true});cancelHoboSync(d,id);assert.equal(d.prepare('SELECT enabled FROM hobo_loggers').get().enabled,1);d.close();
});

test('cancelling in-flight work discards the response and cannot change CANCELLED back to retry or done',async()=>{
  const d=store(),id=queueHoboSync(d,{serial:'12345678',start,end});let release;
  const running=runHoboSync(d,()=>new Promise(resolve=>{release=resolve;}));
  assert.equal(d.prepare('SELECT status FROM hobo_jobs').get().status,'RUNNING');cancelHoboSync(d,id);release([observation()]);
  assert.equal((await running).status,'CANCELLED');assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,0);
  const job=d.prepare('SELECT * FROM hobo_jobs').get();assert.equal(job.status,'CANCELLED');assert.equal(job.cursor,start);assert.equal(job.attempts,0);d.close();
});

test('running requests receive an abort signal promptly after cancellation',async()=>{
  const d=store(),id=queueHoboSync(d,{serial:'12345678',start,end});let aborted=false,timer;
  const running=runHoboSync(d,({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true})));
  cancelHoboSync(d,id);
  try{
    const result=await Promise.race([running,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cancel did not abort request')),4000);})]);
    assert.equal(result.status,'CANCELLED');assert.ok(aborted);
  }finally{clearTimeout(timer);d.close();}
});

test('cancellation between a saturated response and its split children prevents further API access',async()=>{
  const d=store(),id=queueHoboSync(d,{serial:'12345678',start,end});let calls=0;
  const result=await runHoboSync(d,args=>fetchHoboWindow({...args,token:'TEST_ONLY',fetchImpl:async()=>{
    calls++;cancelHoboSync(d,id);return json({max_results:true,data:[]});
  }}));
  assert.equal(result.status,'CANCELLED');assert.equal(calls,1);assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,0);d.close();
});

test('failed jobs can be cancelled but completed work is not silently relabelled',async()=>{
  const d=store(),id=queueHoboSync(d,{serial:'12345678',start,end});d.prepare("UPDATE hobo_jobs SET status='FAILED' WHERE id=?").run(id);cancelHoboSync(d,id);
  assert.equal(d.prepare('SELECT status FROM hobo_jobs WHERE id=?').get(id).status,'CANCELLED');
  const completed=queueHoboSync(d,{serial:'12345678',start,end:start});await runHoboSync(d,async()=>[]);
  assert.throws(()=>cancelHoboSync(d,completed),/已完成/);assert.throws(()=>cancelHoboSync(d,'missing'),/找不到/);d.close();
});

test('bulk cancellation skips completed/cancelled work and only pauses devices whose jobs were changed',()=>{
  const d=store(),ids=[];const statuses=['QUEUED','RUNNING','FAILED','DONE','CANCELLED'];
  for(let i=0;i<statuses.length;i++){
    const serial=String(23456780+i);saveHoboLogger(d,{serial,name:'test',start,enabled:true});
    const id=queueHoboSync(d,{serial,start,end});ids.push(id);d.prepare('UPDATE hobo_jobs SET status=? WHERE id=?').run(statuses[i],id);
  }
  const result=manageHoboJobs(d,{ids:[...ids,ids[0]],operation:'cancel',confirmation:'CANCEL'});
  assert.equal(result.requested,5);assert.equal(result.cancelled,3);assert.equal(result.skipped,2);
  for(let i=0;i<ids.length;i++){
    assert.equal(d.prepare('SELECT enabled FROM hobo_loggers WHERE serial=?').get(String(23456780+i)).enabled,i<3?0:1);
    assert.equal(d.prepare('SELECT status FROM hobo_jobs WHERE id=?').get(ids[i]).status,i===3?'DONE':'CANCELLED');
  }d.close();
});

test('bulk deletion requires DELETE and rejects the entire batch if any job is active or missing',()=>{
  const d=store(),id=queueHoboSync(d,{serial:'12345678',start,end});
  saveHoboLogger(d,{serial:'23456789',name:'other',start,enabled:false});const done=queueHoboSync(d,{serial:'23456789',start,end});d.prepare("UPDATE hobo_jobs SET status='DONE' WHERE id=?").run(done);
  assert.throws(()=>manageHoboJobs(d,{ids:[done],operation:'delete',confirmation:''}),/確認/);
  assert.throws(()=>manageHoboJobs(d,{ids:[done,id],operation:'delete',confirmation:'DELETE'}),/先取消/);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_jobs').get().n,2);
  assert.throws(()=>manageHoboJobs(d,{ids:[done,'missing'],operation:'delete',confirmation:'DELETE'}),/已變更/);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_jobs').get().n,2);
  manageHoboJobs(d,{ids:[id],operation:'cancel',confirmation:'CANCEL'});
  assert.equal(manageHoboJobs(d,{ids:[done,id],operation:'delete',confirmation:'DELETE'}).deleted,2);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_months').get().n,0);
  assert.throws(()=>manageHoboJobs(d,{ids:[],operation:'cancel',confirmation:'CANCEL'}),/1 至 100/);d.close();
});

test('bulk cancel followed by job deletion cannot publish an in-flight response or recreate a removed job',async()=>{
  const d=store(),id=queueHoboSync(d,{serial:'12345678',start,end});let release;
  const running=runHoboSync(d,()=>new Promise(resolve=>{release=resolve;}));
  manageHoboJobs(d,{ids:[id],operation:'cancel',confirmation:'CANCEL'});manageHoboJobs(d,{ids:[id],operation:'delete',confirmation:'DELETE'});release([observation()]);
  assert.equal((await running).status,'CANCELLED');assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_jobs').get().n,0);assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,0);d.close();
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
  assert.equal((await GET(new Request('http://local/api/hobo?action=overview'))).status,403);
  role='admin';origin=false;assert.equal((await POST(new Request('http://local/api/hobo',{method:'POST'}))).status,403);
  const response=await GET(new Request('http://local/api/hobo?'+params));assert.equal(response.status,200);assert.match(response.headers.get('Content-Disposition'),/HOBO_12345678_20261001_20261003/);assert.match(await response.text(),/logger_sn/);
  const insert=d.prepare('INSERT INTO hobo_observations VALUES(?,?,?,?,?,?,?,?)');
  for(const [sensor,type,unit] of [['s-1','Temperature','°C'],['s-2','RH','%']])insert.run('12345678',sensor,start,'CURRENT','1',12,unit,type);
  const overview=await GET(new Request('http://local/api/hobo?action=overview'));assert.equal(overview.status,200);assert.equal(overview.headers.get('Cache-Control'),'no-store');
  const summary=(await overview.json()).loggers.find(l=>l.serial==='12345678');assert.equal(summary.observations,2);assert.equal(summary.first,start);assert.equal(summary.latest,start);
  params.set('action','query');params.set('measurement','temperature');params.set('sensor','s-1');params.set('q','°C');
  const searched=await GET(new Request('http://local/api/hobo?'+params));assert.equal(searched.status,200);const data=await searched.json();assert.equal(data.rows.length,1);assert.equal(data.rows[0].sensor_sn,'s-1');
  params.set('action','csv');const filtered=await (await GET(new Request('http://local/api/hobo?'+params))).text();assert.ok(filtered.includes('Temperature'));assert.ok(!filtered.includes('"RH"'));
  const id=queueHoboSync(d,{serial:'12345678',start,end});origin=true;
  const cancelled=await POST(new Request('http://local/api/hobo',{method:'POST',body:JSON.stringify({action:'cancel',id})}));assert.equal(cancelled.status,200);assert.equal(d.prepare('SELECT status FROM hobo_jobs WHERE id=?').get(id).status,'CANCELLED');
  role='member';const bulk=()=>new Request('http://local/api/hobo',{method:'POST',body:JSON.stringify({action:'jobsBulk',operation:'delete',ids:[id],confirmation:'DELETE'})});
  assert.equal((await POST(bulk())).status,403);role='admin';origin=false;assert.equal((await POST(bulk())).status,403);origin=true;
  const deleted=await POST(bulk());assert.equal(deleted.status,200);assert.equal((await deleted.json()).deleted,1);
  d.close();
});

test('duplicate payloads and repeat syncs do not insert or rewrite unchanged observations; corrections update in place',async()=>{
  const d=store();
  d.exec(`CREATE TABLE observation_writes(kind TEXT);CREATE TRIGGER count_hobo_insert AFTER INSERT ON hobo_observations BEGIN INSERT INTO observation_writes VALUES('insert');END;
    CREATE TRIGGER count_hobo_update AFTER UPDATE ON hobo_observations BEGIN INSERT INTO observation_writes VALUES('update');END;`);
  const sync=async rows=>{queueHoboSync(d,{serial:'12345678',start,end:start});assert.equal((await runHoboSync(d,async()=>rows)).status,'DONE');};
  const values=[observation(start,0),{...observation(start,null),sensor_sn:'other-sensor'}];
  await sync([...values,...values]);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,2);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM observation_writes').get().n,2);
  await sync(values);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM observation_writes').get().n,2,'zero and null repeats cause no SQL update');
  await sync([{...values[0],value:5}, {...values[1],data_type:'CORRECTED'}]);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,2);
  assert.equal(d.prepare("SELECT COUNT(*) n FROM observation_writes WHERE kind='update'").get().n,2);
  await sync([{...values[0],unit:'°F'},{...values[0],data_type_id:'different-type'}]);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,4,'distinct units and data types are independent observations');
  d.close();
});


test('sync job total counts all records beyond the latest 30 and updates after deletion',()=>{
  const d=store();assert.equal(hoboStatus(d).jobs_total,0);const ids=[];
  for(let i=0;i<32;i++){const id=queueHoboSync(d,{serial:'12345678',start,end});cancelHoboSync(d,id);ids.push(id);}
  let status=hoboStatus(d);assert.equal(status.jobs_total,32);assert.equal(status.jobs.length,30);
  manageHoboJobs(d,{operation:'delete',ids:[ids[0]],confirmation:'DELETE'});
  status=hoboStatus(d);assert.equal(status.jobs_total,31);assert.equal(status.jobs.length,30);d.close();
});


test('device schedule state and active job status remain distinct after manual sync and cancellation',()=>{
  const d=store();let logger=hoboStatus(d).loggers[0];assert.equal(logger.enabled,0);assert.equal(logger.active_job_status,null);
  const id=queueHoboSync(d,{serial:'12345678',start,end});logger=hoboStatus(d).loggers[0];assert.equal(logger.enabled,0);assert.equal(logger.active_job_status,'QUEUED');
  d.prepare("UPDATE hobo_jobs SET status='RUNNING' WHERE id=?").run(id);assert.equal(hoboStatus(d).loggers[0].active_job_status,'RUNNING');
  cancelHoboSync(d,id);assert.equal(hoboStatus(d).loggers[0].active_job_status,null);assert.equal(hoboStatus(d).loggers[0].enabled,0);d.close();
});
