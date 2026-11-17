import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
function load(file){let index=0;const states=[];const Selector=()=>null;
 const deps={react:{useState:initial=>{const i=index++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useEffect:()=>{},useCallback:f=>f,useRef:v=>({current:v})},'react/jsx-runtime':jsx,'@/components/ui/button':{Button:'button'},'@/components/ui/input':{Input:'input'},'@/components/ui/label':{Label:'label'},'@/components/AslungDeviceSelector':{default:Selector},'@/components/HistoricalBatchProgress':{default:()=>null},'@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogTitle','DialogHeader','DialogDescription'].map(k=>[k,'div']))};
 const code=ts.transpileModule(readFileSync(new URL('../components/'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,m={exports:{}};new Function('require','module','exports',code)(k=>{assert.ok(k in deps,k);return deps[k];},m,m.exports);
 return {Selector,states,render(props){index=0;return m.exports.default(props);}};
}
function find(n,p){if(!React.isValidElement(n))return null;if(p(n))return n;for(const c of React.Children.toArray(n.props.children)){const r=find(c,p);if(r)return r;}return null;}
const settle=()=>new Promise(r=>setImmediate(r));
test('searchable device selector selects matching IDs without dropping existing selections',()=>{
 const f=load('AslungDeviceSelector.tsx');let selected=['AL-9'];const props=()=>({devices:['AL-1','AL-2','AL-9'],selected,onChange:v=>selected=v,isEnglish:false,label:'ASLUNG ID'});
 let tree=f.render(props());find(tree,n=>n.props['aria-label']==='搜尋 ASLUNG ID').props.onChange({target:{value:'AL-1'}});
 tree=f.render(props());find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});assert.deepEqual(selected,['AL-9','AL-1']);
 find(f.render(props()),n=>n.type==='button'&&n.props.children==='清空選取').props.onClick();assert.deepEqual(selected,[]);
});
test('cleanup previews send selected IDs and inclusive date filters; all preview clears only the scope',async()=>{
 const f=load('ProcessingCleanup.tsx'),calls=[],props={api:async(url,init)=>{calls.push(JSON.parse(init.body));return {id:'plan',filters:calls.at(-1).filters,totals:{},items:[]};},devices:['AL-1','AL-2'],filters:{device:'',from:'2025-01-01',to:'2025-01-31',status:'',kind:'raw'},isEnglish:false,formatTime:v=>v,onChange:()=>{}};
 let tree=f.render(props);find(tree,n=>n.type===f.Selector).props.onChange(['AL-1','AL-2']);tree=f.render(props);
 find(tree,n=>n.type==='button'&&n.props.children==='預覽清除範圍').props.onClick();await settle();assert.deepEqual(calls[0].filters.devices,['AL-1','AL-2']);assert.equal(calls[0].filters.from,'2025-01-01');assert.equal(calls[0].filters.to,'2025-01-31');assert.equal(calls[0].filters.kind,'raw');
 // Close and independently preview all raw archives.
 find(f.render(props),n=>n.type==='button'&&n.props.children==='預覽全部清除（本類型）').props.onClick();await settle();assert.deepEqual(calls[1].filters,{device:'',devices:[],from:'',to:'',status:'',kind:'raw'});
});
test('history import sends multiple devices with the selected content kind and does not enable S3 itself',async()=>{
 const f=load('ProcessingHistoryImport.tsx'),calls=[],props={devices:['AL-1','AL-2'],isEnglish:false,s3:true,onChange:()=>{},api:async(url,init)=>{calls.push(JSON.parse(init.body));return {created:2,reused:0,raw_jobs:2,processed_jobs:0,skipped:0,skipped_examples:[]};}};
 let tree=f.render(props);find(tree,n=>n.type===f.Selector).props.onChange(['AL-1','AL-2']);
 f.states[1]='2025-01-01';f.states[2]='2025-01-02';f.states[3]='raw';tree=f.render(props);
 find(tree,n=>n.type==='button'&&n.props.children==='建立歷史封存工作').props.onClick();await settle();assert.deepEqual(calls[0].devices,['AL-1','AL-2']);assert.equal(calls[0].kind,'raw');assert.equal(calls[0].action,'historical');
 const disabled=load('ProcessingHistoryImport.tsx');assert.equal(find(disabled.render({...props,s3:false}),n=>n.type==='button'&&n.props.children==='建立歷史封存工作').props.disabled,true);
});
