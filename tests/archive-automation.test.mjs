import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {ensureArchiveAutomation,saveArchiveAutomation,runArchiveAutomation,archiveAutomationStatus,retryArchiveAutomation} from '../lib/archive-automation.mjs';
import {enqueueProcessing,claimProcessing} from '../lib/processing-jobs.mjs';
import {saveGlobalProcessing} from '../lib/global-processing.mjs';
import {observeProcessingDay,discoverNewProcessingRows} from '../lib/processing-raw.mjs';
import {ensureCalibrationSchema,saveCalibrationSource,syncCalibrationSource} from '../lib/calibration.mjs';
const configuration={mode:'s3',bucket:'fixture',region:'ap-northeast-1'},now=new Date('2027-02-05T04:00:00Z');
const hash=s=>createHash('sha256').update(s).digest('hex');
const obs={count:2,raw:hash('raw'),processed:hash('processed')};
function fixture(){const d=new DatabaseSync(':memory:');d.exec("CREATE TABLE devices(id TEXT PRIMARY KEY); INSERT INTO devices VALUES('AL-1');");ensureCalibrationSchema(d);ensureArchiveAutomation(d);return d;}
async function factors(d){const id=saveCalibrationSource(d,{name:'Test',url:'https://docs.google.com/spreadsheets/d/test/edit?gid=0'},'admin');await syncCalibrationSource(d,id,'admin',async()=>'aslung_id,PM,slope1,intercept1,Start_date\nAL-1,PM1,1,0,2023/1/1',{force:true});}
const run=(d,extra={})=>runArchiveAutomation(d,{now,configuration,observe:async()=>obs,arrivals:async()=>({baseline:'100',rows:[]}),...extra});
test('daily, monthly and manual work share source versions; changed sources and explicit refresh create revisions',async()=>{
 const d=fixture();try{await factors(d);saveGlobalProcessing(d,{enabled:true,actor:'admin'});let r=await run(d);assert.equal(r.kind,'daily');assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,2);
 const job=d.prepare("SELECT * FROM processing_jobs WHERE data_kind='processed'").get();
 assert.equal(enqueueProcessing(d,{device:job.device,start:job.start,end:job.end,actor:'manual'}),job.id);
 assert.notEqual(enqueueProcessing(d,{device:job.device,start:job.start,end:job.end,actor:'manual',refresh:'explicit'}),job.id);
 // A monthly check of the same day uses daily jobs, regardless of the actor.
 d.prepare("INSERT INTO archive_runs VALUES('monthly:test','monthly','2027-01',?)").run(now.toISOString());
 d.prepare("INSERT INTO archive_units(run_id,device,start,end,up_limit) VALUES('monthly:test','AL-1',?,?,3)").run(job.start,job.end);
 await run(d);await run(d);const before=d.prepare('SELECT count(*) n FROM processing_jobs').get().n;
 r=await run(d);assert.equal(r.kind,'monthly');assert.equal(r.jobs.processed,job.id);assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,before);
 d.prepare("UPDATE archive_units SET status='PENDING' WHERE run_id='monthly:test'").run();r=await run(d,{observe:async()=>({...obs,raw:hash('changed'),processed:hash('changed-context')})});assert.notEqual(r.jobs.processed,job.id);
 // Recent jobs are claimed before older monthly jobs.
 assert.equal(claimProcessing(d).actor,'daily-archive');
 }finally{d.close();}
});
test('monthly planning runs once after configured day and advances one source day per round, including raw without coefficients',async()=>{
 const d=fixture();try{saveArchiveAutomation(d,{monthlyEnabled:true,lateEnabled:false,monthDay:5},'admin');await run(d,{now:new Date('2027-02-04T04:00:00Z')});assert.equal(d.prepare('SELECT count(*) n FROM archive_runs').get().n,0);
 let reads=0;await run(d,{observe:async()=>{reads++;return obs;}});await run(d,{observe:async()=>{reads++;return obs;}});assert.equal(reads,2);assert.equal(d.prepare('SELECT count(*) n FROM archive_runs').get().n,1);assert.equal(d.prepare('SELECT count(*) n FROM archive_units').get().n,31);assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,2);assert.ok(d.prepare("SELECT skipped FROM archive_units WHERE status='PLANNED'").all().every(r=>r.skipped==='NO_FACTOR'));
 const state=archiveAutomationStatus(d);assert.equal(state.runs[0].pending,29);assert.equal(state.runs[0].verified,0);
 }finally{d.close();}
});
test('late-arrival baseline and cursor survive restart, include months-old rows, and do not advance after failure',async()=>{
 const d=fixture();try{saveArchiveAutomation(d,{monthlyEnabled:false,lateEnabled:true,monthDay:5},'admin');await run(d);assert.equal(archiveAutomationStatus(d).settings.cursor,'100');
 const later=new Date(now.getTime()+61000);let r=await run(d,{now:later,arrivals:async cursor=>{assert.equal(cursor,'100');return {rows:[{id:'101',device:'AL-1',day:'2025-01-01'}]};}});assert.equal(r.kind,'late');assert.equal(r.start,'2024-12-31T16:00:00.000Z');assert.equal(archiveAutomationStatus(d).settings.cursor,'101');
 await run(d,{now:new Date(later.getTime()+61000),arrivals:async()=>{throw new Error('source offline');}});assert.equal(archiveAutomationStatus(d).settings.cursor,'101');assert.match(archiveAutomationStatus(d).settings.last_error,/source offline/);
 retryArchiveAutomation(d);await run(d,{now:new Date(later.getTime()+122000),arrivals:async()=>({rows:[]})});assert.equal(archiveAutomationStatus(d).settings.cursor,'101');
 }finally{d.close();}
});
test('lease prevents overlapping scans; source errors can retry; permanent cleanup suppression prevents recreation',async()=>{
 const d=fixture();try{saveArchiveAutomation(d,{monthlyEnabled:true,lateEnabled:false,monthDay:5},'admin');d.prepare('UPDATE archive_automation SET lease_until=? WHERE id=1').run(Date.now()+999999);assert.equal(await run(d),null);d.prepare('UPDATE archive_automation SET lease_until=0').run();
 await run(d,{observe:async()=>{throw new Error('temporary failure');}});assert.equal(archiveAutomationStatus(d).runs[0].failed,1);retryArchiveAutomation(d);
 d.prepare("INSERT INTO archive_suppressions VALUES('AL-1','2026-12-31T16:00:00.000Z','2027-01-01T16:00:00.000Z','raw','now')").run();await run(d);assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,0);assert.match(d.prepare("SELECT skipped FROM archive_units WHERE status='PLANNED'").get().skipped,/RAW_SUPPRESSED/);
 for(const p of [{monthlyEnabled:true,lateEnabled:true,monthDay:0},{monthlyEnabled:'yes',lateEnabled:true,monthDay:5}])assert.throws(()=>saveArchiveAutomation(d,p,'admin'),e=>e.status===400);
 }finally{d.close();}
});
test('source fingerprints include counts, IDs and ordered context, and arrival scans are bounded primary-key SELECTs',async()=>{
 const queries=[];let count=0;const pool={query:async q=>{queries.push(q);if(q.sql.includes('COUNT(*)'))return [[{sample_count:'2',last_id:'500'}]];return [[{id:String(++count)}]];}};
 const a=await observeProcessingDay(pool,'AL-1','2027-01-01Z','2027-01-02Z'),b=await observeProcessingDay(pool,'AL-1','2027-01-01Z','2027-01-02Z');assert.equal(a.raw,b.raw);assert.notEqual(a.processed,b.processed);assert.ok(queries.every(q=>q.timeout===60000));
 await discoverNewProcessingRows(pool,'500');assert.match(queries.at(-1).sql,/WHERE id>\? ORDER BY id LIMIT 2000/);assert.deepEqual(queries.at(-1).values,['500']);await assert.rejects(discoverNewProcessingRows(pool,'unsafe'));
});
test('settings changes during source IO cannot publish jobs and a lost lease cannot overwrite another worker progress',async()=>{
 const d=fixture();try{saveArchiveAutomation(d,{monthlyEnabled:true,lateEnabled:false,monthDay:5},'admin');
 await run(d,{observe:async()=>{saveArchiveAutomation(d,{monthlyEnabled:false,lateEnabled:false,monthDay:5},'admin');return obs;}});assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,0);assert.equal(d.prepare("SELECT count(*) n FROM archive_units WHERE status='FAILED'").get().n,1);
 retryArchiveAutomation(d);
 await run(d,{observe:async()=>{d.prepare("UPDATE archive_automation SET owner='other-worker'").run();d.prepare("UPDATE archive_units SET status='PLANNED' WHERE start=(SELECT min(start) FROM archive_units)").run();return obs;}});
 assert.equal(d.prepare("SELECT status FROM archive_units ORDER BY start LIMIT 1").get().status,'PLANNED');assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,0);
 }finally{d.close();}
});
test('confirmed permanent cleanup suppresses automatic recreation; explicit manual revision restores that exact day and kind',async()=>{
 const {previewCleanup,confirmCleanup}=await import('../lib/processing-cleanup.mjs');
 const d=fixture();try{saveArchiveAutomation(d,{monthlyEnabled:true,lateEnabled:false,monthDay:5},'admin');const result=await run(d);
 const job=d.prepare('SELECT * FROM processing_jobs WHERE id=?').get(result.jobs.raw);
 const plan=await previewCleanup(d,{actor:'admin',filters:{device:'AL-1',kind:'raw',from:'2027-01-01',to:'2027-01-01'}},{root:'/tmp/aslung-archive-nonexistent-fixture',inventory:async()=>[]});
 await confirmCleanup(d,{id:plan.id,actor:'admin',confirmation:'DELETE',pauseSchedules:false},{saveBackup:async()=>'/test/backup'});
 assert.equal(d.prepare('SELECT count(*) n FROM archive_suppressions').get().n,1);assert.equal(d.prepare('SELECT status FROM processing_jobs WHERE id=?').get(job.id).status,'DELETING');
 const restored=enqueueProcessing(d,{device:job.device,start:job.start,end:job.end,dataKind:'raw',actor:'admin',refresh:'explicit-restore'});assert.notEqual(restored,job.id);assert.equal(d.prepare('SELECT count(*) n FROM archive_suppressions').get().n,0);
 }finally{d.close();}
});
