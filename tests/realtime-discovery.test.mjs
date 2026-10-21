import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {visibleRealtimeRows,mergeRealtimeRows,discoverRealtimeDevices} from '../lib/realtime-discovery.mjs';

test('discovery results are rendered independently with measurements and registration actions for every unknown device',()=>{
  const Button=({children,onClick,disabled})=>React.createElement('button',{onClick,disabled},children);
  const dependencies={'react':React,'react/jsx-runtime':jsxRuntime,'lucide-react':{Search:()=>null,TriangleAlert:()=>null},'@/components/ui/button':{Button}};
  const source=readFileSync(new URL('../components/RealtimeDiscovery.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in dependencies,name);return dependencies[name];},module,module.exports);
  const Results=module.exports.RealtimeDiscoveryResults,registered=[];
  const rows=[
    {aslung_id:'AL-new-1',timestamp:new Date().toISOString(),PM1_G3:0,'PM2.5_G3':5,PM10_G3:8,temperature:24,rh:70,battery:3.87},
    {aslung_id:'AL-new-2',timestamp:new Date(Date.now()-2*3600000).toISOString(),PM1_G3:11},
    {aslung_id:'AL-now-registered',timestamp:new Date().toISOString()}
  ];
  const tree=Results({rows,formatTime:()=> 'DISPLAYED TIME',onRegister:id=>registered.push(id),registeredIds:['AL-now-registered']});
  const html=renderToStaticMarkup(tree);
  for(const row of rows)assert.ok(html.includes(row.aslung_id));
  assert.equal((html.match(/<tr/g)||[]).length,4);
  assert.equal((html.match(/DISPLAYED TIME/g)||[]).length,3);
  assert.match(html,/電池 \(battery\)/);assert.match(html,/>3\.87<\/td>/);assert.match(html,/>0<\/td>/);assert.match(html,/已斷線/);assert.match(html,/已完成補登/);
  assert.equal((html.match(/補登設備<\/button>/g)||[]).length,2);
  const buttons=[];
  function visit(element){if(!React.isValidElement(element))return;if(element.type===Button)buttons.push(element);React.Children.forEach(element.props.children,visit);}
  visit(tree);buttons[0].props.onClick();assert.deepEqual(registered,['AL-new-1']);
  assert.equal(Results({rows:[],formatTime:s=>s,onRegister:()=>{},registeredIds:[]}),null);
});

test('only undeployed readings older than one year are hidden',()=>{
  const now=new Date('2026-10-15T12:00:00Z');
  const readings=[
    {aslung_id:'old-standby',timestamp:'2025-10-15T11:59:59Z'},
    {aslung_id:'boundary',timestamp:'2025-10-15T12:00:00Z'},
    {aslung_id:'recent-standby',timestamp:'2026-10-15T11:30:00Z'},
    {aslung_id:'deployed-old',timestamp:'2020-01-01T00:00:00Z'},
    {aslung_id:'active-location',timestamp:'2020-01-01T00:00:00Z'}
  ];
  const devices=readings.map(r=>({id:r.aslung_id,status:r.aslung_id==='deployed-old'?'DEPLOYED':'STANDBY'}));
  const locations=[{aslung_id:'active-location',start_time:'2024-01-01',active:1,end_time:null}];
  assert.deepEqual(visibleRealtimeRows(readings,devices,locations,now).map(r=>r.aslung_id),['boundary','recent-standby','deployed-old','active-location']);
  assert.equal(readings.length,5); // The source remains available in device management.
});

test('known and discovered readings merge by ID using the newest timestamp',()=>{
  const merged=mergeRealtimeRows([{aslung_id:'AL-1',timestamp:'2026-10-01T00:00:00Z'}],
    [{aslung_id:'AL-1',timestamp:'2026-10-02T00:00:00Z'},{aslung_id:'AL-2',timestamp:'2026-10-03T00:00:00Z',unregistered:true}]);
  assert.equal(merged.length,2);assert.equal(merged[0].aslung_id,'AL-2');assert.equal(merged[1].timestamp,'2026-10-02T00:00:00Z');
});

test('discovery is time-bounded, excludes registered IDs and returns measurements without registering devices',async()=>{
  const calls=[];
  const pool={async query(options,params){
    calls.push({options,params});
    if(calls.length===1){
      assert.match(options.sql,/time >= \? AND time <= \?/);assert.match(options.sql,/uid NOT IN/);
      assert.deepEqual(params,['2026-10-08 12:00:00','2026-10-15 12:00:00','AL-1',201]);
      assert.equal(options.timeout,15000);
      return [[{aslung_id:'AL-2'},{aslung_id:'AL-3'},{aslung_id:'AL-1'}]];
    }
    assert.notEqual(params[0],'AL-1');assert.match(options.sql,/ch7 AS battery/);
    if(params[0]==='AL-3')throw new Error('upstream failure');
    return [[{aslung_id:params[0],time:'2026-10-15 11:59:00',PM1_G3:12,battery:0}]];
  }};
  const result=await discoverRealtimeDevices(pool,['AL-1'],7,new Date('2026-10-15T12:00:00Z'));
  assert.equal(result.devices.length,1);assert.equal(result.devices[0].aslung_id,'AL-2');
  assert.equal(result.devices[0].unregistered,true);assert.equal(result.devices[0].timestamp,'2026-10-15T11:59:00.000Z');
  assert.equal(result.devices[0].battery,0);assert.equal(result.failedCount,1);assert.equal(result.truncated,false);
  assert.ok(calls.every(c=>/^SELECT/.test(c.options.sql))); // Upstream is strictly read-only.
});

test('discovery caps large results and reports truncation',async()=>{
  let first=true,lookups=0;
  const result=await discoverRealtimeDevices({async query(options,params){
    if(first){first=false;return [Array.from({length:201},(_,i)=>({aslung_id:`AL-${i}`}))];}
    lookups++;return [[{aslung_id:params[0],time:new Date('2026-10-15T11:00:00Z')}]];
  }},[],1,new Date('2026-10-15T12:00:00Z'));
  assert.equal(lookups,200);assert.equal(result.devices.length,200);assert.equal(result.truncated,true);
});

test('discovery endpoint rejects members and invalid periods before touching MySQL',async()=>{
  let role='member',queries=0;
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const deps={
    '@/lib/server':{identity:async()=>({role}),AppError,fail:e=>Response.json({error:e.message},{status:e.status||500}),db:()=>({prepare:()=>({all:async()=>({results:[]})})})},
    '@/lib/data':{getPool:()=>({query:async()=>{queries++;return [[]];}})},
    '@/lib/realtime-discovery.mjs':{discoverRealtimeDevices}
  };
  const source=readFileSync(new URL('../app/api/realtime/discover/route.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','exports','module',code)(name=>{assert.ok(name in deps);return deps[name];},module.exports,module);
  const route=module.exports;
  assert.equal((await route.GET(new Request('http://localhost/api/realtime/discover?days=7'))).status,403);
  role='admin';assert.equal((await route.GET(new Request('http://localhost/api/realtime/discover?days=9999'))).status,400);
  assert.equal(queries,0);
  const res=await route.GET(new Request('http://localhost/api/realtime/discover?days=7'));
  assert.equal(res.status,200);assert.equal((await res.json()).devices.length,0);assert.equal(queries,1);
});

test('discovered devices participate in regular refresh only for administrators',async()=>{
  let role='admin';const queried=[];
  const deps={
    '@/lib/server':{identity:async()=>({role}),fail:e=>Response.json({error:e.message},{status:500}),db:()=>({prepare:()=>({all:async()=>({results:[{id:'AL-1'}]})})})},
    '@/lib/data':{getPool:()=>({query:async(sql,[id])=>{assert.match(sql,/ch7 AS battery/);queried.push(id);return [[{aslung_id:id,time:new Date('2026-10-15T12:00:00Z'),battery:id==='AL-1'?0:'3.87'}]];}})}
  };
  const source=readFileSync(new URL('../app/api/realtime/route.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','exports','module',code)(name=>{assert.ok(name in deps);return deps[name];},module.exports,module);
  const route=module.exports;
  const res=await route.GET(new Request('http://localhost/api/realtime?extra_ids=AL-2,AL-1'));
  assert.equal(res.status,200);assert.deepEqual(queried,['AL-1','AL-2']);
  const rows=await res.json();assert.equal(rows.find(r=>r.aslung_id==='AL-2').unregistered,true);
  assert.equal(rows.find(r=>r.aslung_id==='AL-1').unregistered,undefined);
  assert.equal(rows.find(r=>r.aslung_id==='AL-1').battery,0);
  assert.equal(rows.find(r=>r.aslung_id==='AL-2').battery,'3.87');
  role='member';queried.length=0;
  assert.equal((await route.GET(new Request('http://localhost/api/realtime?extra_ids=AL-2'))).status,403);
  assert.equal(queried.length,0);
  role='admin';
  assert.equal((await route.GET(new Request('http://localhost/api/realtime?extra_ids=invalid%20id'))).status,400);
  assert.equal(queried.length,0);
});
