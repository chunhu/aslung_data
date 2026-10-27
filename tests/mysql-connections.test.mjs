import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {mysqlOptions,sharedMysqlPool} from '../lib/mysql-options.mjs';
import {checkCalibrationMysql} from '../scripts/check-calibration-mysql.mjs';
const env={MYSQL_HOST:'fixture.invalid',MYSQL_USER:'fixture',MYSQL_DATABASE:'fixture'};

test('app and worker use bounded pools with idle cleanup, and validate overrides',()=>{
  const app=mysqlOptions('app',env),worker=mysqlOptions('worker',env);
  assert.equal(app.connectionLimit,4);assert.equal(app.maxIdle,1);assert.equal(worker.connectionLimit,1);assert.equal(worker.maxIdle,0);
  assert.equal(app.idleTimeout,30000);assert.ok(app.maxIdle<app.connectionLimit);assert.ok(worker.maxIdle<worker.connectionLimit);
  assert.equal(mysqlOptions('app',{...env,MYSQL_CONNECTION_LIMIT:'2'}).connectionLimit,2);
  assert.equal(mysqlOptions('worker',{...env,MYSQL_WORKER_CONNECTION_LIMIT:'3'}).connectionLimit,3);
  for(const value of ['0','31','invalid','1.5'])assert.throws(()=>mysqlOptions('app',{...env,MYSQL_CONNECTION_LIMIT:value}));
  assert.throws(()=>mysqlOptions('app',{}),/MYSQL_HOST/);
});

test('route module copies share one lazy app pool per process registry',()=>{
  const registry={},calls=[];const factory=options=>{calls.push(options);return {id:calls.length};};
  const first=sharedMysqlPool(factory,env,registry),second=sharedMysqlPool(()=>assert.fail('duplicate pool'),env,registry);
  assert.equal(first,second);assert.equal(calls.length,1);
  const source=readFileSync(new URL('../lib/data.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const registryForRoutes={};let creates=0;
  function load(){const module={exports:{}};const deps={'./server':{AppError:Error},'mysql2/promise':{default:{createPool:()=>({id:++creates})}},'./mysql-options.mjs':{sharedMysqlPool:factory=>sharedMysqlPool(factory,env,registryForRoutes)}};new Function('require','module','exports',code)(name=>deps[name],module,module.exports);return module.exports;}
  assert.equal(load().getPool(),load().getPool());assert.equal(creates,1);
});

test('worker preflight acquires only one connection and closes it on success or query failure',async()=>{
  for(const fails of [false,true]){
    const events=[];const run=checkCalibrationMysql({env,createConnection:async options=>{
      assert.equal(options.connectionLimit,undefined);events.push('connect');return {query:async query=>{events.push('query');assert.match(query.sql,/FROM rawdata LIMIT 0$/);if(fails)throw Object.assign(new Error('query failed'),{code:'ER_CON_COUNT_ERROR'});},end:async()=>{events.push('end');}};
    }});
    if(fails)await assert.rejects(run,{code:'ER_CON_COUNT_ERROR'});else await run;
    assert.deepEqual(events,['connect','query','end']);
  }
  await assert.rejects(checkCalibrationMysql({env,createConnection:async()=>{throw Object.assign(new Error('full'),{code:'ER_CON_COUNT_ERROR'});}}),{code:'ER_CON_COUNT_ERROR'});
});
