import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import JSZip from 'jszip';
import * as c from '../lib/calibration.mjs';
import * as permissions from '../lib/permissions.mjs';
import * as exports from '../lib/csv-zip.mjs';

const original='aslung_id,PM,slope1,intercept1,Start_date,End_date\nAL-1,PM1,2,1,2020/1/1,2024/1/1\nAL-1,PM1,3,0,2024/1/1,';
function fixture(){const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON');c.ensureCalibrationSchema(d);const id=c.saveCalibrationSource(d,{name:'Original source',url:'https://docs.google.com/spreadsheets/d/test/edit?gid=0',description:'Original description'},'admin');return {d,id};}
const sync=(d,id,csv=original)=>c.syncCalibrationSource(d,id,'admin',async()=>csv,{force:true});

test('new import snapshots preserve exact input, version, source metadata and all validation errors',async()=>{
  const {d,id}=fixture();try{
    assert.equal((await sync(d,id)).status,'UPDATED');
    const first=c.listCalibrationHistory(d).logs[0],version=first.version_id;
    const bad=original.replace(',2,1,',',bad,1,').replace(',3,0,',',bad,0,');
    assert.equal((await sync(d,id,bad)).status,'FAILED');
    const failed=c.listCalibrationHistory(d).logs[0],detail=c.calibrationHistoryFiles(d,failed.id);
    assert.equal(detail.issues.length,2);assert.equal(detail.csv,bad);assert.equal(detail.log.version_id,null);assert.equal(detail.records.length,0);
    assert.deepEqual(detail.issues.map(i=>i.rows),[[2],[3]]);
    c.saveCalibrationSource(d,{id,name:'Renamed source',url:'https://docs.google.com/spreadsheets/d/changed/edit?gid=0',description:'Changed'},'admin');
    const snapshot=c.calibrationHistoryFiles(d,first.id);
    assert.equal(snapshot.csv,original);assert.equal(snapshot.log.version_id,version);assert.equal(snapshot.records.length,2);
    assert.equal(snapshot.log.source_name,'Original source');assert.equal(snapshot.log.source_description,'Original description');assert.match(snapshot.log.source_url,/\/test\//);
    assert.equal(snapshot.records[0].end,snapshot.records[1].start);
  }finally{d.close();}
});

test('unchanged imports share compressed files and identify the exact preserved version',async()=>{
  const {d,id}=fixture();try{
    await sync(d,id);assert.equal((await sync(d,id)).status,'UNCHANGED');
    const {logs}=c.listCalibrationHistory(d);
    assert.equal(logs.length,2);assert.equal(logs[0].version_id,logs[1].version_id);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_import_files').get().n,1);
    c.deleteCalibrationHistory(d,[logs[0].id],'admin');
    assert.equal(c.calibrationHistoryFiles(d,logs[1].id).csv,original);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_import_files').get().n,1);
    c.deleteCalibrationHistory(d,[logs[1].id],'admin');
    assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_import_files').get().n,0);
    assert.equal(c.currentCalibrationRecords(d).length,2);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_versions').get().n,1);
    assert.equal(d.prepare("SELECT COUNT(*) n FROM calibration_history_events WHERE action='DELETE_LOG'").get().n,2);
    assert.equal(d.prepare('PRAGMA foreign_key_check').all().length,0);
    await sync(d,id);
    assert.ok(c.listCalibrationHistory(d).logs[0].id>Math.max(...logs.map(l=>l.id)));
    assert.throws(()=>c.calibrationHistoryDetail(d,logs[0].id),e=>e.status===404);
  }finally{d.close();}
});

test('notes use optimistic revisions, preserve original outcomes and retain audit; old logs never invent snapshots',async()=>{
  const {d,id}=fixture();try{
    await sync(d,id);const log=c.listCalibrationHistory(d).logs[0];
    c.editCalibrationHistory(d,{id:log.id,note:'Investigate this import',revision:0},'manager');
    const changed=c.calibrationHistoryDetail(d,log.id).log;
    assert.equal(changed.note,'Investigate this import');assert.equal(changed.actor,log.actor);assert.equal(changed.message,log.message);assert.equal(changed.revision,1);
    assert.throws(()=>c.editCalibrationHistory(d,{id:log.id,note:'Overwrite',revision:0},'other'),e=>e.status===409);
    assert.throws(()=>c.editCalibrationHistory(d,{id:log.id,note:'a'.repeat(3001),revision:1},'manager'),e=>e.status===400);
    const old=Number(d.prepare("INSERT INTO calibration_sync_logs(source_id,status,message,created_at,actor) VALUES(?,'FAILED','Legacy error','2020-01-01T00:00:00Z','legacy')").run(id).lastInsertRowid);
    for(const revision of [0,1])c.editCalibrationHistory(d,{id:old,note:'Legacy note '+revision,revision},'admin');
    const legacy=c.calibrationHistoryFiles(d,old);
    assert.equal(legacy.log.has_snapshot,0);assert.equal(legacy.csv,null);assert.equal(legacy.log.version_id,null);assert.equal(legacy.records.length,0);
    assert.equal(d.prepare("SELECT COUNT(*) n FROM calibration_history_events WHERE action='EDIT_NOTE'").get().n,3);
    assert.throws(()=>c.deleteCalibrationHistory(d,[log.id,99999],'admin'),e=>e.status===404);
    assert.equal(c.calibrationHistoryDetail(d,log.id).log.note,changed.note); // whole deletion rolled back
  }finally{d.close();}
});

test('source deletion archives safely, stops future sync/application and preserves history and coefficient versions',async()=>{
  const {d,id}=fixture();try{
    await sync(d,id);const log=c.listCalibrationHistory(d).logs[0];
    d.prepare('UPDATE calibration_sources SET lease_until=? WHERE id=?').run(Date.now()+60000,id);
    assert.throws(()=>c.archiveCalibrationSource(d,id,'admin'),e=>e.status===409);
    d.prepare('UPDATE calibration_sources SET lease_until=0 WHERE id=?').run(id);
    c.archiveCalibrationSource(d,id,'admin');
    assert.equal(c.currentCalibrationRecords(d).length,0);
    assert.equal((await c.syncCalibrationSource(d,id,'worker',()=>{throw Error('must not fetch');},{force:true})).status,'SKIPPED');
    assert.throws(()=>c.setCalibrationSourceEnabled(d,id,true,'admin'),e=>e.status===404);
    assert.throws(()=>c.saveCalibrationSource(d,{id,name:'x',url:'https://docs.google.com/spreadsheets/d/test/edit?gid=0'},'admin'),e=>e.status===404);
    const history=c.calibrationHistoryFiles(d,log.id);assert.equal(history.csv,original);assert.equal(history.records.length,2);assert.equal(history.log.source_archived,1);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM calibration_versions').get().n,1);
  }finally{d.close();}
});

function route(d,actor){
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const dependencies={
    '@/lib/server':{identity:async()=>actor,writeGuard:req=>{if(req.headers.get('origin')!=='http://test')throw new AppError(403,'origin');},AppError,fail:e=>Response.json({error:e.message},{status:e.status||500})},
    '@/lib/permissions.mjs':permissions,'@/lib/store.mjs':{getConnection:()=>d},'@/lib/calibration.mjs':c,'@/lib/csv-zip.mjs':exports,jszip:JSZip
  };
  const code=ts.transpileModule(readFileSync(new URL('../app/api/calibration/history/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in dependencies,name);return dependencies[name];},module,module.exports);return module.exports;
}
test('history API protects reads/downloads/writes, validates IDs and exports ZIP with actual attempt contents',async()=>{
  const {d,id}=fixture(),actor={role:'member',email:'manager'};const api=route(d,actor);
  const get=(q='')=>api.GET(new Request('http://test/api/calibration/history'+q));
  const post=(p,origin='http://test')=>api.POST(new Request('http://test/api/calibration/history',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(p)}));
  try{
    await sync(d,id);const log=c.listCalibrationHistory(d).logs[0];
    for(const role of ['member','viewer','device_manager']){
      actor.role=role;assert.equal((await get()).status,403);assert.equal((await get(`?id=${log.id}&download=1`)).status,403);assert.equal((await post({action:'delete',ids:[log.id]})).status,403);
    }
    actor.role='calibration_manager';assert.equal((await get()).status,200);assert.equal((await get('?id=NaN')).status,400);assert.equal((await get('?offset=-1')).status,400);
    assert.equal((await post({action:'delete',ids:[log.id]},'http://evil')).status,403);
    const response=await get(`?id=${log.id}&download=1`);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');
    const zip=await JSZip.loadAsync(await response.arrayBuffer());
    assert.ok(zip.file('metadata.json'));assert.ok(zip.file('report.txt'));assert.ok(zip.file('source.csv'));assert.ok(zip.file('coefficients.csv'));assert.equal(zip.file('issues.csv'),null);
    assert.equal((await zip.file('source.csv').async('string')).replace(/^\uFEFF/,''),original);
    assert.match(await zip.file('coefficients.csv').async('string'),/AL-1/);
    await sync(d,id,original.replace(',2,1,',',oops,1,'));const failed=c.listCalibrationHistory(d).logs[0];
    const failedZip=await JSZip.loadAsync(await (await get(`?id=${failed.id}&download=1`)).arrayBuffer());
    assert.ok(failedZip.file('issues.csv'));assert.equal(failedZip.file('coefficients.csv'),null);assert.match(await failedZip.file('source.csv').async('string'),/oops/);
    assert.equal((await post({action:'note',id:log.id,note:'OK',revision:0})).status,200);
    assert.equal((await post({action:'note',id:log.id,note:'stale',revision:0})).status,409);
    actor.role='admin';assert.equal((await post({action:'delete',ids:[log.id]})).status,200);assert.equal((await get(`?id=${log.id}`)).status,404);
    assert.equal((await post({action:'delete',ids:[]})).status,400);
  }finally{d.close();}
});

test('history list and detail pagination do not truncate records or full reports in downloads',async()=>{
  const {d,id}=fixture();try{
    const body='aslung_id,PM,slope1,intercept1,Start_date\n'+Array.from({length:205},(_,i)=>`AL-${i},PM1,1,0,2024/1/1`).join('\n');
    await sync(d,id,body);const log=c.listCalibrationHistory(d).logs[0];
    const first=c.calibrationHistoryDetail(d,log.id),last=c.calibrationHistoryDetail(d,log.id,200);
    assert.equal(first.records.length,100);assert.equal(first.hasMore,true);assert.equal(last.records.length,5);assert.equal(last.hasMore,false);
    assert.equal(c.calibrationHistoryFiles(d,log.id).records.length,205);
    const insert=d.prepare("INSERT INTO calibration_sync_logs(source_id,status,message,created_at,actor) VALUES(?,'FAILED',?,'2020-01-01T00:00:00Z','test')");
    for(let i=0;i<52;i++)insert.run(id,'first line\n'+('report '.repeat(200)));
    assert.equal(c.listCalibrationHistory(d).logs.length,50);assert.equal(c.listCalibrationHistory(d).total,53);assert.equal(c.listCalibrationHistory(d,{offset:50}).logs.length,3);
    const recent=c.listCalibrationHistory(d).logs[0];assert.equal(recent.message,'first line');assert.match(c.calibrationHistoryDetail(d,recent.id).log.message,/report/);
  }finally{d.close();}
});

test('fetch failures have a downloadable report without capturing an HTML login page or a previous version',async()=>{
  const {d,id}=fixture();try{
    await sync(d,id);
    for(const fetchCsv of [async()=>'<html>Sign in</html>',async()=>{throw new Error('HTTP 403');}]){
      assert.equal((await c.syncCalibrationSource(d,id,'worker',fetchCsv,{force:true})).status,'FAILED');
      const log=c.listCalibrationHistory(d).logs[0],detail=c.calibrationHistoryFiles(d,log.id);
      assert.equal(detail.csv,null);assert.equal(detail.log.version_id,null);assert.equal(detail.log.has_snapshot,1);assert.equal(detail.log.has_file,0);
    }
    assert.equal(c.currentCalibrationRecords(d).length,2);
  }finally{d.close();}
});
