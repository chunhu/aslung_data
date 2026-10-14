import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import * as segments from '../lib/download-segments.mjs';

function loadTs(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module = {exports:{}};
  new Function('require','exports','module',code)(name => {
    if (!(name in dependencies)) throw new Error('Unexpected import: '+name);
    return dependencies[name];
  },module.exports,module);
  return module.exports;
}

test('real API authorization enforces segment/device identity and downloads every allowed interval', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE devices(id TEXT); CREATE TABLE maintainers(name TEXT,email TEXT);
    CREATE TABLE device_locations(id INTEGER,aslung_id TEXT,lab_id TEXT,maintainer TEXT,start_time TEXT,end_time TEXT,active INTEGER);
    CREATE TABLE grants(email TEXT,grant_type TEXT,device_id TEXT,lab_id TEXT,start TEXT,end TEXT);
    INSERT INTO devices VALUES('AL-0609'),('AL-0610');
    INSERT INTO device_locations VALUES(1,'AL-0609','N0059','','2026-01-01T00:00:00Z','2026-01-10T00:00:00Z',0);
    INSERT INTO device_locations VALUES(2,'AL-0609','N0060','','2026-02-01T00:00:00Z',NULL,1);
    INSERT INTO grants VALUES('member@example.test','lab',NULL,'N0059','2026-01-02T00:00:00Z','2026-01-03T00:00:00Z');
    INSERT INTO grants VALUES('member@example.test','lab',NULL,'N0059','2026-01-05T00:00:00Z','2026-01-06T00:00:00Z');`);
  const store = {prepare(query) {
    const stmt = sql.prepare(query);
    let args=[];
    return {bind(...values){args=values;return this;},all(){return {results:stmt.all(...args)};},first(){return stmt.get(...args);}};
  }};
  const server = loadTs('../lib/server.ts',{
    'node:crypto': {}, './download-segments.mjs':segments,
    './store.mjs':{getStore:()=>store}, './auth':{}
  });
  const member={role:'member',email:'member@example.test',name:'Member'};
  const start='2026-01-01T00:00:00.000Z',end='2026-01-10T00:00:00.000Z';
  try {
    assert.equal((await server.downloadSegments(member)).length,1);
    await assert.rejects(server.permitted(member,'AL-0609',start,end),e=>e.status===403);
    await assert.rejects(server.authorizedDataRanges(member,'AL-0610',start,end,'1'),e=>e.status===403);
    await assert.rejects(server.authorizedDataRanges(member,'AL-0609',start,end,'2'),e=>e.status===403);
    await server.permitted(member,'AL-0609','2026-01-02T12:00:00Z','2026-01-02T13:00:00Z');
    const calls=[];
    const route=loadTs('../app/api/data/route.ts',{
      '@/lib/download-segments.mjs':segments,
      '@/lib/server':{...server,identity:async()=>member},
      '@/lib/data':{fetchPage:async(id,s,e)=>{
        calls.push({id,start:s,end:e});return {data:[{timestamp:s}],has_more:false,next_cursor:null};
      },toCsv:rows=>rows.map(r=>r.timestamp).join('\n')}
    });
    const query=new URLSearchParams({aslung_id:'AL-0609',segment_id:'1',start,end,download:'1',format:'json'});
    const response=await route.GET(new Request('http://localhost/api/data?'+query));
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.data.length,2);
    assert.equal(body.authorized_ranges.length,2);
    assert.deepEqual(calls.map(c=>[c.start,c.end]),[
      ['2026-01-02T00:00:00.000Z','2026-01-03T00:00:00.000Z'],
      ['2026-01-05T00:00:00.000Z','2026-01-06T00:00:00.000Z']
    ]);
    query.set('segment_id','2');
    assert.equal((await route.GET(new Request('http://localhost/api/data?'+query))).status,403);
  } finally {sql.close();}
});
