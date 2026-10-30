import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {inclusiveCalibrationEnd} from '../lib/calibration-dates.mjs';

const code=ts.transpileModule(readFileSync(new URL('../components/CalibrationRecordTable.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function component(states=[]){
  let index=0;const updates=new Map();
  const tag=name=>({children,...props})=>React.createElement(name,Object.fromEntries(Object.entries(props).filter(([key])=>['disabled','role','aria-label','checked'].includes(key))),children);
  const deps={react:{...React,useState:initial=>{const i=index++;return [i<states.length?states[i]:initial,value=>updates.set(i,value)];},useEffect:()=>{}},'react/jsx-runtime':jsx,
    '@/components/ui/button':{Button:tag('button')},'@/components/ui/input':{Input:tag('input')},
    '@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription'].map(name=>[name,tag('div')])),
    '@/lib/calibration-dates.mjs':{inclusiveCalibrationEnd}};
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);
  return {View:module.exports.default,updates};
}
function find(tree,predicate){
  if(!React.isValidElement(tree))return null;if(predicate(tree))return tree;
  for(const child of React.Children.toArray(tree.props.children)){const found=find(child,predicate);if(found)return found;}return null;
}
const record={id:1,version_id:1,aslung_id:'AL-Z',channel:'PM1_G3',start:'2026-01-01T00:00:00.000Z',end:null,a1:0,b1:0,breakpoint:null,a2:null,b2:null,row_number:2,source_name:'Test',source_enabled:1,quality:'{}',is_current:1};
const props={records:[record,{...record,id:2,is_current:0}],api:()=>assert.fail('unexpected mutation'),formatTime:s=>s,isEnglish:false,disabled:false,onChange:()=>{}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('edited parameters show a visible label, editor and timestamp including historical versions',()=>{
  const {View}=component();
  const html=renderToStaticMarkup(View({...props,records:[{...record,is_current:0,manual_edited_at:'2026-10-29T01:02:03.000Z',manual_edited_by:'editor@example.test'}]}));
  assert.match(html,/已手動編輯/);assert.match(html,/editor@example.test/);assert.match(html,/2026-10-29T01:02:03.000Z/);
});

test('selection only includes editable current rows and edit preserves IDs ending in Z and zero coefficients',()=>{
  const {View,updates}=component();const tree=View(props);
  assert.equal(find(tree,n=>n.props['aria-label']==='選取校正參數 2').props.disabled,true);
  find(tree,n=>n.props['aria-label']==='全選本頁目前版本參數').props.onChange({target:{checked:true}});
  assert.deepEqual([...updates.get(0)],[1]);
  find(tree,n=>n.props.children==='編輯').props.onClick();
  assert.equal(updates.get(1),record);assert.equal(updates.get(2).aslung_id,'AL-Z');
  assert.equal(updates.get(2).start,'2026-01-01T00:00:00.000');
  assert.equal(updates.get(2).a1,'0');assert.equal(updates.get(2).a2,'');
});

test('edit submits exact UTC boundaries and zero values, refreshes on success and retains API errors',async()=>{
  const draft={aslung_id:'AL-Z',channel:'PM1_G3',start:'2026-10-01T00:00',end:'2026-10-02T00:00',a1:'0',b1:'0',breakpoint:'',a2:'',b2:''};
  const calls=[];let refreshed=0;
  let {View,updates}=component([new Set(),record,draft,null,'',false,'','']);
  let tree=View({...props,api:async(url,options)=>{calls.push(JSON.parse(options.body));return {message:'Saved'};},onChange:()=>refreshed++});
  find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();
  assert.deepEqual(calls,[{action:'records',operation:'edit',ids:[1],patch:{...draft,start:'2026-10-01T00:00:00.000Z',end:'2026-10-02T00:00:00.000Z'},confirmation:''}]);
  assert.equal(refreshed,1);assert.equal(updates.get(7),'Saved');assert.equal(updates.get(1),null);
  ({View,updates}=component([new Set(),record,draft,null,'',false,'','']));
  tree=View({...props,api:async()=>{throw new Error('參數版本已變更');}});
  find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();
  assert.equal(updates.get(6),'參數版本已變更');assert.equal(updates.has(1),false);
});

test('batch delete requires DELETE and sends the frozen confirmation IDs',async()=>{
  let {View}=component([new Set([1]),null,{},[record],'',false,'','']);
  let tree=View(props);assert.equal(find(tree,n=>n.props.children==='確認刪除').props.disabled,true);
  const calls=[];
  ({View}=component([new Set([1,3]),null,{},[record],'DELETE',false,'','']));
  tree=View({...props,records:[record,{...record,id:3}],api:async(url,options)=>{calls.push(JSON.parse(options.body));return {message:'Deleted'};}});
  const confirm=find(tree,n=>n.props.children==='確認刪除');assert.equal(confirm.props.disabled,false);
  confirm.props.onClick();await tick();
  assert.deepEqual(calls,[{action:'records',operation:'delete',ids:[1],confirmation:'DELETE'}]);
  const html=renderToStaticMarkup(tree);assert.match(html,/保留既有成果與歷史版本/);
});
