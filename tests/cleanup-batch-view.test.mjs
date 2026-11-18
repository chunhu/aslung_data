import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
function harness(){let index=0;const states=[];const deps={react:{useState:initial=>{const i=index++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=v];}},'react/jsx-runtime':jsx,'@/components/ui/button':{Button:'button'}};
 const code=ts.transpileModule(readFileSync(new URL('../components/CleanupBatchProgress.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,m={exports:{}};new Function('require','module','exports',code)(name=>deps[name],m,m.exports);return {render(props){index=0;return m.exports.default(props);}};}
function find(n,p){if(!React.isValidElement(n))return null;if(p(n))return n;for(const c of React.Children.toArray(n.props.children)){const found=find(c,p);if(found)return found;}return null;}
const batch={plan_id:'plan',state:'RUNNING',total:1001,batches:3,current_batch:2,done:501,cancelled:0,running:1,failed:0,filters:{kind:'raw',devices:['AL-1'],from:'2020-01-01'},created_at:'now'};
const tick=()=>new Promise(r=>setImmediate(r));
test('progress provides pause/resume/retry and a separate explicit cancellation confirmation',async()=>{
 const calls=[],f=harness(),props={batches:[batch],isEnglish:false,formatTime:v=>v,onChange:()=>calls.push('reload'),api:async(url,init)=>{calls.push(JSON.parse(init.body));return {ok:true};}};
 let tree=f.render(props);assert.equal(find(tree,n=>n.type==='progress').props.value,501);assert.equal(find(tree,n=>n.type==='progress').props.max,1001);
 await find(tree,n=>n.type==='button'&&n.props.children==='暫停').props.onClick();await tick();assert.deepEqual(calls[0],{action:'control',id:'plan',operation:'pause'});
 tree=f.render({...props,batches:[{...batch,state:'PAUSED'}]});await find(tree,n=>n.type==='button'&&n.props.children==='繼續').props.onClick();await tick();assert.equal(calls.at(-2).operation,'resume');
 tree=f.render({...props,batches:[{...batch,state:'FAILED'}]});await find(tree,n=>n.type==='button'&&n.props.children==='重試失敗工作').props.onClick();await tick();assert.equal(calls.at(-2).operation,'retry');
 tree=f.render(props);find(tree,n=>n.type==='button'&&n.props.children==='取消剩餘工作').props.onClick();tree=f.render(props);assert.ok(find(tree,n=>n.props.role==='alert'));await find(tree,n=>n.type==='button'&&n.props.children==='確認取消剩餘工作').props.onClick();await tick();assert.equal(calls.at(-2).operation,'cancel');
});
test('completed and cancelled runs cannot be restarted and cancellation contributes to resolved progress',()=>{
 for(const state of ['DONE','CANCELLED']){const f=harness(),tree=f.render({batches:[{...batch,state,done:501,cancelled:500}],isEnglish:false,formatTime:v=>v});assert.equal(find(tree,n=>n.type==='button'),null);assert.equal(find(tree,n=>n.type==='progress').props.value,1001);}
});
