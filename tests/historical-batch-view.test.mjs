import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function find(n,p){if(!React.isValidElement(n))return null;if(p(n))return n;for(const c of React.Children.toArray(n.props.children)){const r=find(c,p);if(r)return r;}return null;}
function view(){let i=0;const values=[];const deps={react:{useState:initial=>{const at=i++;if(!(at in values))values[at]=initial;return [values[at],v=>values[at]=v];}},'react/jsx-runtime':jsx,'@/components/ui/button':{Button:'button'}};
 const code=ts.transpileModule(readFileSync(new URL('../components/HistoricalBatchProgress.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,m={exports:{}};new Function('require','module','exports',code)(k=>{assert.ok(k in deps,k);return deps[k];},m,m.exports);return props=>{i=0;return m.exports.default(props);};}
const batch={id:'batch',status:'RUNNING',configuration:{from:'2025-01-01',to:'2025-12-31',devices:['AL-1'],kinds:['raw','processed']},completed_months:3,total_months:12,verified:180,skipped:5,total_units:730,raw_rows:100,processed_rows:80,bytes:2048,current_month:3,current:{label:'2025-04',verified:15,skipped:5,total:60,generated:50,queued:20,running:1,waiting_upload:9,uploading:1,failed:0,skipped_examples:'[]'},months:[{position:3,label:'2025-04',status:'RUNNING',total:60}]};
test('monthly and overall progress distinguish skipped work, verified files, row types and available controls',()=>{
 const render=view(),props={batches:[batch],api:()=>{},isEnglish:false,onChange:()=>{}},tree=render(props),html=renderToStaticMarkup(tree);
 for(const text of ['3 / 12','2025-04','15 / 60','缺少係數略過','原始','校正'])assert.ok(html.includes(text),text);
 assert.equal(find(tree,n=>n.props['aria-label']==='整體封存進度').props.value,185/730*100);
 assert.ok(find(tree,n=>n.type==='button'&&n.props.children==='暫停'));assert.equal(find(tree,n=>n.type==='button'&&n.props.children==='重試'),null);
 for(const [status,label] of [['PAUSED','Resume'],['FAILED','Retry']])assert.ok(find(render({...props,isEnglish:true,batches:[{...batch,status}]}),n=>n.type==='button'&&n.props.children===label));
 assert.equal(find(render({...props,batches:[{...batch,status:'COMPLETED'}]}),n=>n.type==='button'),null);
});
test('pause, resume and retry target their batch; cancellation requires confirmation and never requests deletion',async()=>{
 const calls=[],render=view(),api=async(url,options)=>calls.push(JSON.parse(options.body)),props={batches:[batch],api,isEnglish:false,onChange:()=>{}};
 const settle=()=>new Promise(r=>setImmediate(r));
 for(const [status,label,operation] of [['RUNNING','暫停','pause'],['PAUSED','繼續','resume'],['FAILED','重試','retry']]){find(render({...props,batches:[{...batch,status}]}),n=>n.type==='button'&&n.props.children===label).props.onClick();await settle();assert.deepEqual(calls.at(-1),{action:'historicalControl',id:'batch',operation});}
 const old=globalThis.window;try{globalThis.window={confirm:()=>false};find(render(props),n=>n.type==='button'&&n.props.children==='取消批次').props.onClick();await settle();assert.equal(calls.length,3);
  globalThis.window.confirm=()=>true;find(render(props),n=>n.type==='button'&&n.props.children==='取消批次').props.onClick();await settle();assert.deepEqual(calls.at(-1),{action:'historicalControl',id:'batch',operation:'cancel'});
 }finally{globalThis.window=old;}
});
