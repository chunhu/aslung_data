import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {maintainerTable,previewMaintainers,applyMaintainers} from '../lib/maintainer-import.mjs';
function fixture(){const d=new DatabaseSync(':memory:');d.exec(`CREATE TABLE maintainers(name TEXT PRIMARY KEY,email TEXT,english_name TEXT,email_test TEXT,phone TEXT,notes TEXT,created_at TEXT,offline_email_enabled INTEGER DEFAULT 1,maintainer_id TEXT);
 INSERT INTO maintainers VALUES('甲','old@example.test','Existing Name','test@example.test','123','Original notes','old',0,'stable-id');`);return d;}
const input='中文姓名,mail,自訂說明\n甲,new@example.test,New notes\n乙,b@example.test,Second notes';
function mapped(text=input){return {...maintainerTable(text).mapping,notes:2};}
test('mapping an arbitrary notes column previews without writes and applies only after confirmation',()=>{
 const d=fixture();try{
  const mapping=mapped(),preview=previewMaintainers(d,input,mapping);
  assert.deepEqual(preview.counts,{added:1,updated:1,unchanged:0});assert.equal(preview.issues.length,0);
  assert.equal(d.prepare('SELECT notes FROM maintainers').get().notes,'Original notes');
  assert.equal(preview.records[0].notes,'New notes');assert.equal(preview.records[0].english_name,'Existing Name');
  const result=applyMaintainers(d,{text:input,mapping,fingerprint:preview.fingerprint});assert.equal(result.synced,2);
  const row=d.prepare("SELECT * FROM maintainers WHERE name='甲'").get();assert.equal(row.notes,'New notes');assert.equal(row.phone,'123');assert.equal(row.offline_email_enabled,0);assert.equal(row.maintainer_id,'stable-id');assert.equal(row.created_at,'old');
  assert.equal(d.prepare("SELECT offline_email_enabled FROM maintainers WHERE name='乙'").get().offline_email_enabled,1);
  assert.deepEqual(previewMaintainers(d,input,mapping).counts,{added:0,updated:0,unchanged:2});
 }finally{d.close();}
});
test('unmapped optional fields retain existing values; mapped blank notes explicitly clear them',()=>{
 const d=fixture();try{
  const text='Cht_name,mail,notes\n甲,old@example.test,',mapping=maintainerTable(text).mapping;
  const preserve=previewMaintainers(d,text,{...mapping,notes:-1});assert.equal(preserve.records[0].notes,'Original notes');assert.equal(preserve.counts.unchanged,1);
  const clear=previewMaintainers(d,text,mapping);assert.equal(clear.records[0].notes,'');
  applyMaintainers(d,{text,mapping,fingerprint:clear.fingerprint});assert.equal(d.prepare('SELECT notes FROM maintainers').get().notes,'');
 }finally{d.close();}
});
test('invalid mappings, duplicate people, malformed rows and changed previews cannot partially write',()=>{
 const d=fixture();try{
  for(const mapping of [{...mapped(),notes:1},{...mapped(),name:-1},{...mapped(),notes:99}])assert.throws(()=>previewMaintainers(d,input,mapping),e=>e.status===400);
  const bad='name,mail,notes\n甲,new@example.test,new\n甲,broken,duplicate\n丙,c@example.test,'+'X'.repeat(2001),mapping=maintainerTable(bad).mapping,preview=previewMaintainers(d,bad,mapping);
  assert.ok(preview.issues.some(i=>i.row===3));assert.ok(preview.issues.some(i=>i.row===4));
  assert.throws(()=>applyMaintainers(d,{text:bad,mapping,fingerprint:preview.fingerprint}),e=>e.status===400);
  const good=previewMaintainers(d,input,mapped());
  assert.throws(()=>applyMaintainers(d,{text:input,mapping:mapped(),fingerprint:''}),e=>e.status===409);
  assert.throws(()=>applyMaintainers(d,{text:input.replace('New notes','Changed'),mapping:mapped(),fingerprint:good.fingerprint}),e=>e.status===409);
  assert.throws(()=>applyMaintainers(d,{text:input,mapping:{...mapped(),notes:-1},fingerprint:good.fingerprint}),e=>e.status===409);
  d.prepare("UPDATE maintainers SET notes='Manual edit' WHERE name='甲'").run();
  assert.throws(()=>applyMaintainers(d,{text:input,mapping:mapped(),fingerprint:good.fingerprint}),e=>e.status===409);
  assert.equal(d.prepare('SELECT count(*) n FROM maintainers').get().n,1);assert.equal(d.prepare('SELECT email FROM maintainers').get().email,'old@example.test');
 }finally{d.close();}
});
test('CSV quoting, line breaks and header aliases are preserved and oversized sources rejected',()=>{
 const text='\uFEFF姓名,mail,備註\r\n甲,a@example.test,"one, two\nthree"',table=maintainerTable(text);
 assert.equal(table.mapping.notes,2);assert.equal(table.rows[0][2],'one, two\nthree');
 assert.throws(()=>maintainerTable('name,mail\n"unfinished'),e=>e.status===400);
 assert.throws(()=>maintainerTable('X'.repeat(2000001)),e=>e.status===400);
});
