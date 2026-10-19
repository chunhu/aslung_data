import * as permissions from '../lib/permissions.mjs';
import * as zipExports from '../lib/csv-zip.mjs';
import JSZip from 'jszip';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as c from '../lib/calibration.mjs';
import {inclusiveCalibrationEnd} from '../lib/calibration-dates.mjs';

const header='aslung_id,PM,slope1,intercept1,break_point1,slope2,intercept2,Start_date,End_date,r2,Factor_slope_PM1';
const csv=(...rows)=>header+'\n'+rows.join('\n');
const row=(id='AL-0001',channel='PM1',start='2024/01/01',end='')=>`${id},${channel},2,1,10,3,-2,${start},${end},0.98,999`;
function fixture(){const d=new DatabaseSync(':memory:');c.ensureCalibrationSchema(d);const id=c.saveCalibrationSource(d,{name:'Test calibration',url:'https://docs.google.com/spreadsheets/d/test123/edit?gid=0',description:'Test source'},'admin@test');return {d,id};}
test('collects all field errors beyond 30 rows and all nonadjacent interval conflicts in one analysis',()=>{
  const bad=Array.from({length:45},(_,i)=>row('BAD-'+i).replace(',2,1,',',oops,1,'));
  const result=c.analyzeCalibrationCsv(csv(...bad,
    row('OVERLAP','PM1','2024/1/1','2024/12/31'),
    row('OVERLAP','PM1','2024/2/1','2024/2/2'),
    row('OVERLAP','PM1','2024/3/1','2024/3/2'),
    row('DUP'),row('DUP'),
    row('DATES','PM1','2025/1/1','2024/1/1').replace(',2,1,',',oops,wrong,')));
  assert.equal(result.issues.filter(i=>i.reason==='slope1必須為數值').length,46);
  assert.ok(result.issues.some(i=>i.rows[0]===46));
  assert.deepEqual(result.issues.find(i=>i.device==='OVERLAP').rows,[47,48,49]);
  assert.deepEqual(result.issues.find(i=>i.device==='DUP').rows,[50,51]);
  assert.equal(result.issues.filter(i=>i.device==='DATES').length,3);
  assert.throws(()=>c.parseCalibrationCsv(csv(...bad)),e=>e.issues.length===45&&e.message.includes('第 46 列'));
});

test('one failed sync reports field, internal and cross-source conflicts without truncation or partial import',async()=>{
  const {d,id}=fixture();try{
    await c.syncCalibrationSource(d,id,'tester',async()=>csv(row('ORIGINAL')),{force:true});
    const other=c.saveCalibrationSource(d,{name:'Other source',url:'https://docs.google.com/spreadsheets/d/other/edit?gid=0'},'admin');
    await c.syncCalibrationSource(d,other,'tester',async()=>csv(row('CROSS')),{force:true});
    const before=c.currentCalibrationRecords(d),version=d.prepare('SELECT current_version FROM calibration_sources WHERE id=?').get(id).current_version;
    const bad=Array.from({length:200},(_,i)=>row('BAD-'+i).replace(',2,1,',',oops,1,'));
    const result=await c.syncCalibrationSource(d,id,'tester',async()=>csv(...bad,
      row('INTERNAL','PM1','2024/1/1','2025/12/31'),row('INTERNAL','PM1','2025/1/1'),
      row('CROSS').replace(',2,1,',',oops,1,')),{force:true});
    assert.equal(result.status,'FAILED');assert.equal(result.issueCount,203);
    assert.ok(result.message.length>6000);assert.match(result.message,/適用期間重疊/);assert.match(result.message,/跨來源適用期間衝突/);
    assert.match(result.message,/Other source/);assert.match(result.message,/第 204 列/);
    assert.equal(d.prepare('SELECT last_error FROM calibration_sources WHERE id=?').get(id).last_error,result.message);
    assert.equal(d.prepare('SELECT message FROM calibration_sync_logs ORDER BY id DESC LIMIT 1').get().message,result.message);
    assert.equal(d.prepare('SELECT current_version FROM calibration_sources WHERE id=?').get(id).current_version,version);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_versions').get().n,2);
    assert.deepEqual(c.currentCalibrationRecords(d),before);
  }finally{d.close();}
});
function load(path,dependencies){
  const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in dependencies,'Unexpected dependency '+name);return dependencies[name];},module,module.exports);return module.exports;
}
test('parses real headers, maps G3 and GSA independently, and ignores Factor_*',()=>{
  const records=c.parseCalibrationCsv('\uFEFF'+csv(row(),row('AL-0001','PM1_GSA')));
  assert.deepEqual(records.map(r=>r.channel),['PM1_G3','PM1_GSA']);assert.equal(records[0].start,'2023-12-31T16:00:00.000Z');
  const readings=[{aslung_id:'AL-0001',timestamp:'2024-01-01T00:00:00Z',PM1_G3:10,PM1_GSA:11,'PM2.5_G3':null}];
  const output=c.calibrateRows(readings,records.map((r,i)=>({...r,id:i+1,version_id:1})))[0];
  assert.equal(output.PM1_G3,10);assert.equal(output.PM1_G3_calibrated,28); // Python: breakpoint belongs to second segment.
  assert.equal(output.PM1_GSA_calibrated,31);assert.equal(output['PM2.5_G3_calibrated'],null);
  assert.equal(output['PM2.5_G3_calibration_status'],'INVALID_RAW');assert.equal(readings[0].PM1_G3_calibrated,undefined);
});
test('blank end dates form consecutive periods; explicit end dates include the whole Taiwan date',()=>{
  const records=c.parseCalibrationCsv(csv(row(),row('AL-0001','PM1','2025/01/01','2025/01/02')));
  assert.equal(records[0].end,records[1].start);assert.equal(records[1].end,'2025-01-02T16:00:00.000Z');
  const before=c.calibrateRows([{aslung_id:'AL-0001',timestamp:'2025-01-02T15:59:59Z',PM1_G3:1}],records)[0];
  assert.equal(before.PM1_G3_calibrated,3);
  const after=c.calibrateRows([{aslung_id:'AL-0001',timestamp:'2025-01-02T16:00:00Z',PM1_G3:1}],records)[0];
  assert.equal(after.PM1_G3_calibration_status,'NO_FACTOR');assert.equal(after.PM1_G3_calibrated,null);
});
test('rejects malformed values, unsupported channels, missing headers, duplicate starts and overlaps',()=>{
  for(const content of [csv(row().replace('2,1,10','oops,1,10')),csv(row('AL-0001','bad channel')),csv(row('AL-0001','PM1','2025/02/30')),csv(row(),row()),csv(row('AL-0001','PM1','2024/01/01','2025/01/02'),row('AL-0001','PM1','2025/01/01')),csv(row().replace('10,3,-2','10,3,')),header,'<html>login</html>','aslung_id,PM\nAL-0001,PM1'])assert.throws(()=>c.parseCalibrationCsv(content),c.CalibrationError);
});
test('unmapped channels are preserved for lookup without guessing a measurement channel',()=>{
  const records=c.parseCalibrationCsv(csv(row('AL-0001','PM4')));assert.equal(records[0].channel,'UNMAPPED:PM4');
  assert.equal(c.calibrateRows([{aslung_id:'AL-0001',timestamp:'2024-01-01T00:00:00Z',PM1_G3:3}],records)[0].PM1_G3_calibration_status,'NO_FACTOR');
});

test('single segment supports zero slopes, negative results, nulls and missing coefficients without replacing raw',()=>{
  const records=c.parseCalibrationCsv('aslung_id,PM,slope1,intercept1,Start_date\nAL-0001,PM2.5,0,-3,2024/1/1');
  const result=c.calibrateRows([{aslung_id:'AL-0001',timestamp:'2024-01-01T00:00:00Z','PM2.5_G3':4,PM1_G3:7}],records)[0];
  assert.equal(result['PM2.5_G3_calibrated'],-3);assert.equal(result['PM2.5_G3'],4);
  assert.equal(result.PM1_G3_calibration_status,'NO_FACTOR');assert.equal(result.PM1_G3_calibrated,null);
  const conflict=c.calibrateRows([{aslung_id:'AL-0001',timestamp:'2024-01-01T00:00:00Z','PM2.5_G3':4}],[...records,...records])[0];
  assert.equal(conflict['PM2.5_G3_calibration_status'],'CONFLICT');assert.equal(conflict['PM2.5_G3_calibrated'],null);
});
test('sync is atomic, unchanged contents do not create versions, failures retain last successful snapshot',async()=>{
  const {d,id}=fixture();try{
    assert.equal((await c.syncCalibrationSource(d,id,'tester',async()=>csv(row()),{force:true})).status,'UPDATED');
    const original=c.currentCalibrationRecords(d);assert.equal(original.length,1);
    assert.equal((await c.syncCalibrationSource(d,id,'tester',async()=>csv(row()),{force:true})).status,'UNCHANGED');
    assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_versions').get().n,1);
    assert.equal((await c.syncCalibrationSource(d,id,'tester',async()=>csv(row().replace(',2,1,',',4,1,')),{force:true})).status,'UPDATED');
    assert.equal(c.currentCalibrationRecords(d)[0].a1,4);assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_versions').get().n,2);
    for(const fetch of [async()=>header,async()=>{throw new Error('timeout');},async()=>csv(row(),row())])assert.equal((await c.syncCalibrationSource(d,id,'tester',fetch,{force:true})).status,'FAILED');
    assert.equal(c.currentCalibrationRecords(d)[0].a1,4);assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_versions').get().n,2);
    assert.equal(d.prepare('SELECT a1 FROM calibration_records WHERE version_id=?').get(original[0].version_id).a1,2);
    assert.equal(d.prepare('SELECT lease_until FROM calibration_sources').get().lease_until,0);
  }finally{d.close();}
});
test('concurrent sync uses a shared source lease and changed configurations cannot apply stale results',async()=>{
  const {d,id}=fixture();let unblock,entered;const hold=new Promise(r=>unblock=r),ready=new Promise(r=>entered=r);
  try{
    const running=c.syncCalibrationSource(d,id,'tester',async()=>{entered();await hold;return csv(row());},{force:true});await ready;
    assert.equal((await c.syncCalibrationSource(d,id,'tester',async()=>csv(row()),{force:true})).status,'SKIPPED');
    c.saveCalibrationSource(d,{id,name:'Changed',url:'https://docs.google.com/spreadsheets/d/changed/edit?gid=0'},'admin');
    unblock();assert.equal((await running).status,'FAILED');assert.equal(c.currentCalibrationRecords(d).length,0);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_versions').get().n,0);
  }finally{unblock();d.close();}
});
test('cross-source overlaps are blocked, disabling preserves history, and re-enabling validates conflicts',async()=>{
  const {d,id}=fixture();try{
    await c.syncCalibrationSource(d,id,'tester',async()=>csv(row()),{force:true});
    const second=c.saveCalibrationSource(d,{name:'Other',url:'https://docs.google.com/spreadsheets/d/other/edit?gid=3'},'admin');
    assert.equal((await c.syncCalibrationSource(d,second,'tester',async()=>csv(row()),{force:true})).status,'FAILED');
    c.setCalibrationSourceEnabled(d,id,false,'admin');assert.equal(c.currentCalibrationRecords(d).length,0);
    assert.equal((await c.syncCalibrationSource(d,second,'tester',async()=>csv(row()),{force:true})).status,'UPDATED');
    assert.throws(()=>c.setCalibrationSourceEnabled(d,id,true,'admin'),/衝突/);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_versions').get().n,2);
  }finally{d.close();}
});
test('daily scheduling is at Taiwan 02:00; future schedules do not fetch and force checks still respect disabled state',async()=>{
  assert.equal(c.nextCalibrationCheck(new Date('2026-10-19T17:59:59Z')),'2026-10-19T18:00:00.000Z');
  assert.equal(c.nextCalibrationCheck(new Date('2026-10-19T18:00:00Z')),'2026-10-20T18:00:00.000Z');
  const {d,id}=fixture();try{
    d.prepare('UPDATE calibration_sources SET next_check=?').run('2099-01-01T00:00:00Z');
    assert.equal((await c.syncCalibrationSource(d,id,'scheduler',()=>{throw new Error('must not fetch');})).status,'SKIPPED');
    c.setCalibrationSourceEnabled(d,id,false,'admin');
    assert.equal((await c.syncCalibrationSource(d,id,'admin',()=>{throw new Error('must not fetch');},{force:true})).status,'SKIPPED');
  }finally{d.close();}
});
test('only Google sheet URLs with explicit tabs are accepted',()=>{
  for(const url of ['http://127.0.0.1/x','https://evil.test/spreadsheets/d/id/edit?gid=0','https://docs.google.com/spreadsheets/d/id/edit'])assert.throws(()=>c.googleCalibrationUrl(url));
  assert.equal(c.googleCalibrationUrl('https://docs.google.com/spreadsheets/d/id/edit#gid=123').gid,'123');
});
test('calibration API protects admin writes and list access, bounds pagination, and lists all devices including unregistered IDs',async()=>{
  const {d,id}=fixture();let actor={email:'admin@test',role:'admin'};
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const api=load('../app/api/calibration/route.ts',{
    '@/lib/server':{identity:async()=>actor,writeGuard:r=>{if(r.headers.get('origin')!=='http://test')throw new AppError(403,'origin');},AppError,fail:e=>Response.json({error:e.message},{status:e.status||500})},
    '@/lib/store.mjs':{getConnection:()=>d},'@/lib/permissions.mjs':permissions,'@/lib/calibration.mjs':c,'@/lib/calibration-google.mjs':{fetchCalibrationCsv:async()=>csv(row('AL-9999')),calibrationAuthentication:()=> 'public_csv'}
  });
  const post=(payload,origin='http://test')=>api.POST(new Request('http://test/api/calibration',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(payload)}));
  try{
    actor.role='member';assert.equal((await api.GET(new Request('http://test/api/calibration'))).status,403);assert.equal((await post({action:'sync',id})).status,403);
    actor.role='calibration_manager';assert.equal((await api.GET(new Request('http://test/api/calibration'))).status,200);
    actor.role='admin';assert.equal((await post({action:'sync',id},'http://evil')).status,403);
    assert.equal((await post({action:'sync',id})).status,200);
    const data=await (await api.GET(new Request('http://test/api/calibration?device=AL-9999'))).json();
    assert.deepEqual(data.devices,['AL-9999']);assert.equal(data.records.length,1);assert.equal(data.logs.length,1);
    assert.equal((await api.GET(new Request('http://test/api/calibration?offset=-1'))).status,400);
    assert.equal((await post({action:'enabled',id,enabled:'false'})).status,400);
  }finally{d.close();}
});

test('data API pins calibration versions across downloads and pagination, while retaining existing access checks',async()=>{
  const {d,id}=fixture();let denied=false,fetches=0,changeDuringFetch=false,role='member';
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const api=load('../app/api/data/route.ts',{
    '@/lib/download-segments.mjs':{fetchRangesPage:async(ranges,cursor,limit,fetch)=>fetch(ranges[0].start,ranges[0].end,cursor,limit)},
    '@/lib/calibration.mjs':c,'@/lib/store.mjs':{getConnection:()=>d},
    '@/lib/csv-zip.mjs':zipExports,
    '@/lib/server':{identity:async()=>({role}),AppError,required:v=>v,instant:v=>new Date(v).toISOString(),
      permitted:async()=>{if(denied)throw new AppError(403,'denied');},authorizedDataRanges:async()=>[{start:'2024-01-01T00:00:00.000Z',end:'2024-01-02T00:00:00.000Z'}],
      fail:e=>Response.json({error:e.message},{status:e.status||500})},
    '@/lib/permissions.mjs':permissions,
    '@/lib/data':{toCsv:rows=>JSON.stringify(rows),fetchPage:async(device,start,end,cursor)=>{
      fetches++;if(changeDuringFetch&&!cursor)await c.syncCalibrationSource(d,id,'test',async()=>csv(row().replace(',2,1,',',4,1,')),{force:true});
      return {data:[{aslung_id:device,timestamp:'2024-01-01T01:00:00Z',PM1_G3:5}],next_cursor:cursor?null:'next',has_more:!cursor};
    }}
  });
  const request=query=>api.GET(new Request('http://test/api/data?'+new URLSearchParams({aslung_id:'AL-0001',start:'2024-01-01T00:00:00Z',end:'2024-01-02T00:00:00Z',...query})));
  try{
    await c.syncCalibrationSource(d,id,'test',async()=>csv(row()),{force:true});
    let response=await request({calibration:'both'});let first=await response.json();
    assert.equal(first.data[0].PM1_G3_calibrated,11);assert.equal(first.data[0].PM1_G3,5);
    const snapshot=first.calibration_snapshot;changeDuringFetch=true;
    const archive=await JSZip.loadAsync(await (await request({calibration:'both',download:'1',format:'json'})).arrayBuffer(),{checkCRC32:true});
    const download=JSON.parse(await archive.file('aslung_AL-0001_export.json').async('string'));
    assert.equal(download.data.length,2);assert.ok(download.data.every(r=>r.PM1_G3_calibrated===11));
    const next=await (await request({calibration:'both',cursor:'next',calibration_snapshot:snapshot})).json();assert.equal(next.data[0].PM1_G3_calibrated,11);
    const fresh=await (await request({calibration:'both',cursor:'next'})).json();assert.equal(fresh.data[0].PM1_G3_calibrated,21);
    const raw=await (await request({})).json();assert.equal(raw.data[0].PM1_G3_calibrated,undefined);
    role='viewer';const viewerBefore=fetches;assert.equal((await request({download:'1',format:'csv'})).status,403);assert.equal((await request({calibration:'both',download:'1',format:'json'})).status,403);assert.equal(fetches,viewerBefore);assert.equal((await request({calibration:'both',cursor:'next'})).status,200);role='member';
    const before=fetches;denied=true;assert.equal((await request({calibration:'both'})).status,403);assert.equal(fetches,before);denied=false;
    assert.equal((await request({calibration:'both',calibration_snapshot:'1 OR 1=1'})).status,400);
    assert.equal((await request({calibration:'invalid'})).status,400);
  }finally{d.close();}
});

test('background worker runs due sources once and initializes a single timer across bundles',async()=>{
  const {d,id}=fixture();let calls=0;
  const worker=load('../lib/calibration-cron.ts',{'./store.mjs':{getConnection:()=>d},'./calibration.mjs':c,'./calibration-google.mjs':{fetchCalibrationCsv:async()=>{calls++;return csv(row());}}});
  const previous=globalThis.aslungCalibrationCron;delete globalThis.aslungCalibrationCron;
  try{
    await worker.checkCalibrationSources();await worker.checkCalibrationSources();assert.equal(calls,1);
    worker.initCalibrationCron();const timer=globalThis.aslungCalibrationCron;assert.ok(timer);
    worker.initCalibrationCron();assert.equal(globalThis.aslungCalibrationCron,timer);
    assert.ok(d.prepare('SELECT current_version FROM calibration_sources WHERE id=?').get(id).current_version);
  }finally{clearInterval(globalThis.aslungCalibrationCron);if(previous)globalThis.aslungCalibrationCron=previous;else delete globalThis.aslungCalibrationCron;d.close();}
});


test('PM125 is stored under its own name for lookup and never calibrates any measurement',async()=>{
  const {d,id}=fixture();try{
    const result=await c.syncCalibrationSource(d,id,'test',async()=>csv(row('AL-0001','PM125')),{force:true});
    assert.equal(result.status,'UPDATED');assert.match(result.message,/PM125 僅供查詢/);
    const records=c.currentCalibrationRecords(d);assert.equal(records[0].channel,'PM125');
    const raw={aslung_id:'AL-0001',timestamp:'2024-01-01T00:00:00Z',PM125:10,PM1_G3:10,'PM2.5_G3':20,PM10_G3:30};
    const resultRow=c.calibrateRows([raw],records)[0];
    assert.equal(resultRow.PM125,10);assert.equal(resultRow.PM125_calibrated,undefined);
    for(const channel of Object.values(c.CHANNELS))assert.notEqual(resultRow[channel+'_calibration_status'],'CALIBRATED');
  }finally{d.close();}
});


test('implicit end immediately precedes the next start across calendar boundaries and intraday changes',()=>{
  for(const [start,expected] of [['2025/1/1','2024-12-31T15:59:59.999Z'],['2024/3/1','2024-02-29T15:59:59.999Z'],['2025/3/1','2025-02-28T15:59:59.999Z'],['2025-01-01T10:00:00+08:00','2025-01-01T01:59:59.999Z']]){
    const records=c.parseCalibrationCsv(csv(row('AL-0001','PM1','2020/1/1'),row('AL-0001','PM1',start)));
    assert.equal(inclusiveCalibrationEnd(records[0].end),expected);
  }
  const rules=c.parseCalibrationCsv(csv(row('AL-0001','PM1','2024/1/1'),row('AL-0001','PM1','2025-01-01T10:00:00+08:00').replace(',2,1,',',4,1,')));
  const result=c.calibrateRows([
    {aslung_id:'AL-0001',timestamp:'2024-12-31T23:59:59+08:00',PM1_G3:1},
    {aslung_id:'AL-0001',timestamp:'2025-01-01T00:00:00+08:00',PM1_G3:1},
    {aslung_id:'AL-0001',timestamp:'2025-01-01T10:00:00+08:00',PM1_G3:1}
  ],rules);
  assert.deepEqual(result.map(r=>r.PM1_G3_calibration_status),['CALIBRATED','CALIBRATED','CALIBRATED']);
  assert.deepEqual(result.map(r=>r.PM1_G3_calibrated),[3,3,5]);
  const sameDay=c.parseCalibrationCsv(csv(row('AL-0001','PM1','2025-01-01T01:00:00+08:00'),row('AL-0001','PM1','2025-01-01T10:00:00+08:00')));
  assert.equal(sameDay[0].end,sameDay[1].start);
  assert.equal(inclusiveCalibrationEnd(sameDay[0].end),'2025-01-01T01:59:59.999Z');
});


test('same-day date-only handover prioritizes the new rule and preserves source dates and adjustment reason',async()=>{
  const {d,id}=fixture();try{
    const content=csv(row('AL-0039','PM10','2017/8/30','2020/6/8'),row('AL-0039','PM10','2020/6/8').replace(',2,1,',',4,1,'));
    const sync=await c.syncCalibrationSource(d,id,'test',async()=>content,{force:true});assert.equal(sync.status,'UPDATED');assert.match(sync.message,/1 筆已依下一筆開始時間銜接/);
    const records=c.currentCalibrationRecords(d,'AL-0039');assert.equal(records[0].end,records[1].start);
    assert.equal(inclusiveCalibrationEnd(records[0].end),'2020-06-07T15:59:59.999Z');
    assert.equal(records[0].source_end,'2020/6/8');assert.equal(records[1].source_start,'2020/6/8');assert.match(records[0].boundary_note,/新參數優先/);
    const result=c.calibrateRows([{aslung_id:'AL-0039',timestamp:'2020-06-07T23:59:59.999+08:00',PM10_G3:1},{aslung_id:'AL-0039',timestamp:'2020-06-08T00:00:00+08:00',PM10_G3:1}],records);
    assert.deepEqual(result.map(r=>r.PM10_G3_calibrated),[3,5]);
    assert.equal((await c.syncCalibrationSource(d,id,'test',async()=>content,{force:true})).status,'UNCHANGED');
  }finally{d.close();}
});

test('single-day rules remain valid while explicit timestamp overlaps and duplicate starts remain conflicts',()=>{
  const records=c.parseCalibrationCsv(csv(row('AL-1','PM1','2024/2/29','2024/2/29'),row('AL-1','PM2.5','2024/2/29','2024/2/29')));
  assert.ok(records.every(r=>r.end==='2024-02-29T16:00:00.000Z'&&!r.boundary_note));
  assert.throws(()=>c.parseCalibrationCsv(csv(row('AL-1','PM1','2024/1/1','2025-01-01T11:00:00+08:00'),row('AL-1','PM1','2025-01-01T10:00:00+08:00'))),/重疊/);
  assert.throws(()=>c.parseCalibrationCsv(csv(row(),row())),/開始時間重複/);
});


test('adding original-date audit fields preserves historical calibration records',()=>{
  const d=new DatabaseSync(':memory:');try{
    d.exec("CREATE TABLE calibration_records(id INTEGER PRIMARY KEY,version_id INTEGER,aslung_id TEXT,channel TEXT,start TEXT,end TEXT,a1 REAL,b1 REAL,breakpoint REAL,a2 REAL,b2 REAL,row_number INTEGER,quality TEXT); INSERT INTO calibration_records VALUES(1,7,'AL-1','PM1_G3','2024-01-01T00:00:00Z',NULL,2,1,NULL,NULL,NULL,2,'{}')");
    c.ensureCalibrationSchema(d);c.ensureCalibrationSchema(d);
    const stored=d.prepare('SELECT * FROM calibration_records').get();
    assert.equal(stored.version_id,7);assert.equal(stored.a1,2);assert.equal(stored.source_start,'');assert.equal(stored.source_end,'');assert.equal(stored.boundary_note,'');
    assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_records').get().n,1);
  }finally{d.close();}
});
