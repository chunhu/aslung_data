import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {buildFleetRows,filterFleetRows,EMPTY_FLEET_FILTER,fleetCsv} from '../lib/fleet.mjs';
import {parseImportTable,analyzeImport,importDate} from '../lib/fleet-import.mjs';
import {updateFleetDevices,previewFleetImport,applyFleetImport,ensureFleetSchema} from '../lib/fleet-store.mjs';

function database(){
  const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE devices(id TEXT PRIMARY KEY,name TEXT,location TEXT,description TEXT,status TEXT);
    CREATE TABLE device_locations(id INTEGER PRIMARY KEY,aslung_id TEXT REFERENCES devices(id),lab_id TEXT,maintainer TEXT,start_time TEXT,end_time TEXT,active INTEGER);
    CREATE TABLE maintainers(name TEXT);INSERT INTO maintainers VALUES('甲'),('乙');
    CREATE TABLE labs(id TEXT);INSERT INTO labs VALUES('N1'),('N2');
    INSERT INTO devices VALUES('AL-1','','','','DEPLOYED'),('AL-2','','','','STANDBY');
    INSERT INTO device_locations VALUES(1,'AL-1','N1','甲','2026-01-01T00:00:00.000Z',NULL,1);`);
  ensureFleetSchema(d);return d;
}
const header='lab_id,device_id,device_type,maintainer,start_date,end_date,active';

test('fleet uses latest active deployment, flags duplicate/missing maintainer, and distinguishes unavailable readings',()=>{
  const devices=[{id:'AL-1',status:'DEPLOYED'},{id:'AL-2',status:'STANDBY'}];
  const locs=[{id:1,aslung_id:'AL-1',lab_id:'N1',start_time:'2026-01-01',active:1},
    {id:2,aslung_id:'AL-1',lab_id:'N2',start_time:'2026-02-01',active:1},
    {id:3,aslung_id:'AL-2',lab_id:'N1',start_time:'2026-01-01',end_time:'2026-02-01',active:0}];
  const now=Date.parse('2026-10-15T02:00:00Z');
  let rows=buildFleetRows(devices,locs,null,[],60,now);
  assert.equal(rows[0].health,'UNKNOWN');assert.equal(rows[0].lab,'N2');
  assert.ok(rows[0].issues.includes('重複部署'));assert.ok(rows[0].issues.includes('未指派負責人'));
  assert.equal(rows[1].lab,''); // Historical deployments are not shown as current.
  rows=buildFleetRows(devices,locs,[{aslung_id:'AL-1',timestamp:'2026-10-15T01:00:00Z'}],[],60,now);
  assert.equal(rows[0].health,'OFFLINE');assert.equal(rows[1].health,'NODATA');
  assert.equal(filterFleetRows(rows,{...EMPTY_FLEET_FILTER,search:'N2',issue:'ANY'}).length,1);
  assert.equal(filterFleetRows(rows,{...EMPTY_FLEET_FILTER,lab:'UNASSIGNED'}).length,1);
});

test('CSV export preserves multiline notes and neutralizes spreadsheet formulas',()=>{
  const csv=fleetCsv([{id:'AL-1',status:'STANDBY',description:'=HYPERLINK("bad")\nline',issues:[]}]);
  assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/"'=HYPERLINK\(""bad""\)\nline"/);
});

test('import parser handles BOM, TSV, multiline CSV, aliases and exact row diagnostics',()=>{
  const table=parseImportTable('\uFEFF地點編號\t設備編號\t設備類型\t開始日期\nN1\tAL-1\taslung\t2026-10-01');
  assert.equal(table.mapping.device_id,1);
  const parsed=analyzeImport(`${header}\n\nN1,AL-3,aslung,甲,2026-02-30,,Y`);
  assert.equal(parsed.records.length,0);assert.equal(parsed.issues[0].row,3);
  assert.equal(importDate('2026-02-30T00:00:00Z'),null);
  assert.equal(importDate('2026/10/01'),'2026-09-30T16:00:00.000Z');
  assert.equal(parseImportTable('name,note\n"a","line1\nline2"').rows[0][1],'line1\nline2');
});

test('reversed device type/id produces actionable error and can be fixed by mapping without editing source',()=>{
  const text=`${header}\nN1,aslung,AL-3,甲,2026-10-01,,Y`;
  assert.match(analyzeImport(text).issues[0].message,/對調/);
  const map=parseImportTable(text).mapping;
  [map.device_id,map.device_type]=[map.device_type,map.device_id];
  assert.equal(analyzeImport(text,map).records[0].aslung_id,'AL-3');
  assert.throws(()=>analyzeImport(text,{...map,lab_id:map.device_id}),/兩個欄位/);
});

test('preview does not write; apply preserves manual history, audits changes and is idempotent',()=>{
  const d=database();
  try{
    const p={text:`${header}\nN2,AL-3,aslung,乙,2026-10-01,,Y`};
    const preview=previewFleetImport(d,p);
    assert.equal(preview.added,1);assert.equal(preview.newDevices,1);assert.equal(preview.canApply,true);
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM devices').get().n,2);
    applyFleetImport(d,{...p,fingerprint:preview.fingerprint},'admin');
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM device_locations').get().n,2);
    assert.equal(d.prepare('SELECT maintainer FROM device_locations WHERE id=1').get().maintainer,'甲');
    const next=previewFleetImport(d,p);assert.equal(next.unchanged,1);
    applyFleetImport(d,{...p,fingerprint:next.fingerprint},'admin');
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM device_events').get().n,1);
  }finally{d.close();}
});

test('preview rejects multiple active deployments, invalid dates and active records with end dates',()=>{
  const d=database();
  try{
    const result=previewFleetImport(d,{text:`${header}\nN2,AL-1,aslung,甲,2026-10-01,,Y`});
    assert.equal(result.canApply,false);assert.ok(result.issues.some(i=>/多筆使用中/.test(i.message)));
    assert.equal(analyzeImport(`${header}\nN1,AL-4,aslung,甲,2026-10-02,2026-10-01,N`).records.length,0);
    assert.equal(analyzeImport(`${header}\nN1,AL-4,aslung,甲,2026-10-01,2026-10-02,Y`).records.length,0);
  }finally{d.close();}
});

test('concurrent changes invalidate import preview without partially applying records',()=>{
  const d=database();
  try{
    const p={text:`${header}\nN2,AL-3,aslung,甲,2026-10-01,,Y`},preview=previewFleetImport(d,p);
    d.prepare('UPDATE device_locations SET maintainer=? WHERE id=1').run('乙');
    assert.throws(()=>applyFleetImport(d,{...p,fingerprint:preview.fingerprint},'admin'),e=>e.status===409);
    assert.equal(d.prepare("SELECT id FROM devices WHERE id='AL-3'").get(),undefined);
  }finally{d.close();}
});

test('batch maintainer update is atomic; batch maintenance closes deployment and records actor',()=>{
  const d=database();
  try{
    assert.throws(()=>updateFleetDevices(d,{ids:['AL-1','AL-2'],operation:'maintainer',value:'乙'},'admin'),/使用中部署/);
    assert.equal(d.prepare('SELECT maintainer FROM device_locations WHERE id=1').get().maintainer,'甲');
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM device_events').get().n,0);
    updateFleetDevices(d,{ids:['AL-1'],operation:'maintainer',value:'乙'},'admin');
    updateFleetDevices(d,{ids:['AL-1'],operation:'status',value:'MAINTENANCE',note:'更換感測器'},'admin');
    assert.equal(d.prepare('SELECT status FROM devices WHERE id=?').get('AL-1').status,'MAINTENANCE');
    assert.equal(d.prepare('SELECT active FROM device_locations WHERE id=1').get().active,0);
    const events=d.prepare('SELECT * FROM device_events ORDER BY id').all();
    assert.equal(events.length,2);assert.equal(events[1].actor,'admin');assert.match(events[1].note,/更換感測器/);
    assert.throws(()=>updateFleetDevices(d,{ids:['AL-1'],operation:'status',value:'INVALID'},'admin'),/有效狀態/);
  }finally{d.close();}
});
