import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
const file=readFileSync(new URL('../components/PersonalDevices.tsx',import.meta.url),'utf8');
function view(states=[]){
  let index=0;const updates=new Map(),RecordTable=()=>React.createElement('div',null,'Parameter table');
  const tag=name=>({children,...props})=>React.createElement(name,Object.fromEntries(Object.entries(props).filter(([key])=>['disabled','role','aria-label'].includes(key))),children);
  const deps={react:{...React,useState:initial=>{const i=index++;return [i<states.length?states[i]:initial,value=>updates.set(i,value)];},useEffect:()=>{},useCallback:fn=>fn,useRef:value=>({current:value})},'react/jsx-runtime':jsx,
    '@/components/ui/button':{Button:tag('button')},'@/components/ui/input':{Input:tag('input')},'@/components/ui/textarea':{Textarea:tag('textarea')},
    '@/components/CalibrationRecordTable':{default:RecordTable},'@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription'].map(name=>[name,tag('div')]))};
  const code=ts.transpileModule(file,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,module={exports:{}};
  new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);return {View:module.exports.default,updates,RecordTable};
}
function find(node,predicate){if(!React.isValidElement(node))return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const match=find(child,predicate);if(match)return match;}return null;}
const s={id:'my-source',kind:'CSV',name:'Private coefficients',current_version:7,enabled:1};
const detail={source:s,version:7,records:[],versions:[{id:7,created_at:'2026-10-30T00:00:00Z'}]},data={sources:[s],ownerships:[],claims:[],events:[]};
const props={api:async()=>assert.fail(),admin:false,isEnglish:false,formatTime:x=>x,onChanged:()=>{}};
test('research member sees personal source and import workflow, while ownership approval is admin only',()=>{
  const {View}=view([data,false,'','',s.id,detail,'','aslung_id,PM',null,0,null,'']);
  const html=renderToStaticMarkup(View(props));
  for(const label of ['我的 ASLUNG 設備','我的校正參數','下載 CSV 範本','檢查與預覽','套用 CSV 為新版本','NO_FACTOR'])assert.ok(html.includes(label),label);
  assert.ok(!html.includes('設備歸屬審核'));
});
test('personal record adapter attaches the selected source and immutable version, and CSV edits invalidate preview',async()=>{
  const calls=[],{View,updates,RecordTable}=view([data,false,'','',s.id,detail,'','csv',{count:1},0,null,'']);
  const tree=View({...props,api:async(path,options)=>{calls.push({path,payload:JSON.parse(options.body)});return {ok:true};}});
  await find(tree,n=>n.type===RecordTable).props.api('/api/calibration',{method:'POST',body:JSON.stringify({action:'records',operation:'delete',ids:[1],confirmation:'DELETE'})});
  assert.deepEqual(calls,[{path:'/api/personal',payload:{action:'records',operation:'delete',ids:[1],confirmation:'DELETE',source_id:s.id,version:7}}]);
  find(tree,n=>n.props['aria-label']==='校正 CSV').props.onChange({target:{value:'changed csv'}});
  assert.equal(updates.get(7),'changed csv');assert.equal(updates.get(8),null);
});

test('only admins see deletion for released ownerships and confirmation submits the frozen record',async()=>{
  const ended={id:'released',device_id:'AL-1',email:'one@test',start:'2026-01-01',end:'2026-10-30',calibration_enabled:1};
  const state={...data,ownerships:[ended,{...ended,id:'active',end:null,device_id:'AL-2'}]};
  let {View}=view([state,false,'','','',null,'','',null,0,null,'']);
  let tree=View({...props,admin:true});
  assert.ok(find(tree,n=>n.props['aria-label']==='刪除歸屬紀錄 AL-1'));
  assert.equal(find(tree,n=>n.props['aria-label']==='刪除歸屬紀錄 AL-2'),null);
  ({View}=view([state,false,'','','',null,'','',null,0,null,'']));
  tree=View(props);assert.equal(find(tree,n=>n.props['aria-label']==='刪除歸屬紀錄 AL-1'),null);
  const calls=[];
  ({View}=view([state,false,'','','',null,'','',null,0,{kind:'ownershipDelete',item:ended},'']));
  tree=View({...props,admin:true});assert.equal(find(tree,n=>n.props.children==='確認').props.disabled,true);
  ({View}=view([state,false,'','','',null,'','',null,0,{kind:'ownershipDelete',item:ended},'DELETE']));
  tree=View({...props,admin:true,api:async(path,options)=>{if(options)calls.push(JSON.parse(options.body));return state;}});
  assert.equal(find(tree,n=>n.props.children==='確認').props.disabled,false);
  find(tree,n=>n.props.children==='確認').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[{action:'ownershipDelete',id:'released',confirmation:'DELETE'}]);
});

test('notes label and admin-only binding request deletion use the request ID rather than the ownership ID',async()=>{
  const claim={id:'claim-1',device_id:'AL-1',email:'one@test',status:'APPROVED',note:''},state={...data,claims:[claim]};
  let {View}=view([state,false,'','','',null,'','',null,0,null,'']);
  let tree=View({...props,admin:true});
  const html=renderToStaticMarkup(tree);assert.match(html,/備註\/說明/);assert.doesNotMatch(html,/購買／歸屬說明/);
  assert.ok(find(tree,n=>n.props['aria-label']==='刪除綁定申請紀錄 AL-1'));
  ({View}=view([state,false,'','','',null,'','',null,0,null,'']));
  tree=View(props);assert.equal(find(tree,n=>n.props['aria-label']==='刪除綁定申請紀錄 AL-1'),null);
  const calls=[];
  ({View}=view([state,false,'','','',null,'','',null,0,{kind:'claimDelete',item:claim},'']));
  tree=View({...props,admin:true});assert.equal(find(tree,n=>n.props.children==='確認').props.disabled,true);
  ({View}=view([state,false,'','','',null,'','',null,0,{kind:'claimDelete',item:claim},'DELETE']));
  tree=View({...props,admin:true,api:async(path,options)=>{if(options)calls.push(JSON.parse(options.body));return state;}});
  assert.ok(renderToStaticMarkup(tree).includes('已核准的設備綁定與資料授權不受影響'));
  find(tree,n=>n.props.children==='確認').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[{action:'claimDelete',id:'claim-1',confirmation:'DELETE'}]);
});
