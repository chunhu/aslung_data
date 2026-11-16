import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as roles from '../lib/permissions.mjs';
function view(file,states=[]){let i=0;const updates=new Map(),deps={'react':{useState:initial=>{const n=i++;return [n in states?states[n]:initial,value=>updates.set(n,value)];},useEffect:()=>{},useRef:v=>({current:v})},'react/jsx-runtime':jsx,
 '@/lib/permissions.mjs':roles,'date-fns-tz':{formatInTimeZone:()=>'',fromZonedTime:v=>new Date(v)},'@/components/ui/button':{Button:'button'},'@/components/ui/input':{Input:'input'},'@/components/GuestFilesAdmin':{default:()=>null},'@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription'].map(n=>[n,'div']))};
 const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,m={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);return {View:m.exports.default,updates};}
function find(node,predicate){if(!React.isValidElement(node))return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const r=find(child,predicate);if(r)return r;}return null;}
const permissions={view:true,manage:true,download:true,grant:true};
const folders=[{id:'root',name:'未分類',permissions},{id:'p',name:'Project A',permissions}];
test('file manager defaults to all categories, labels each row and resets pagination on category change',()=>{
 const states=[];states[1]={folders,total:2,pages:1,isAdmin:false,groups:[],members:[],files:[{id:'f',name:'One.csv',folder_id:'root',folder_name:'未分類',size:1,permissions},{id:'g',name:'Two.csv',folder_id:'p',folder_name:'Project A',size:1,permissions}]};
 const {View,updates}=view('../components/FileManager.tsx',states),tree=View({api:async()=>{},timezone:'Asia/Taipei',isEnglish:false}),select=find(tree,n=>n.type==='select'&&n.props['aria-label']==='檔案資料夾');
 assert.equal(select.props.value,'all');const html=renderToStaticMarkup(tree);assert.match(html,/全部分類/);assert.match(html,/分類：.*Project A/s);
 select.props.onChange({target:{value:'p'}});assert.equal(updates.get(2),'p');assert.equal(updates.get(3),1);
});
test('uploading from all categories requires choosing an authorized destination',()=>{
 const states=[];states[1]={folders,total:0,pages:1,isAdmin:true,groups:[],members:[],files:[]};states[10]='upload';
 const {View}=view('../components/FileManager.tsx',states),tree=View({api:async()=>{},timezone:'Asia/Taipei',isEnglish:false}),select=find(tree,n=>n.type==='select'&&n.props.name==='folder_id');
 assert.ok(select.props.required);assert.equal(select.props.defaultValue,'');assert.match(renderToStaticMarkup(tree),/請選擇存放分類/);
});
test('feature policy form submits exact member/group selections and policy revision',async()=>{
 const data={features:[{id:'news',label:'最新消息',mode:'selected',emails:['alice@test'],group_ids:['g'],revision:3}],members:[{email:'alice@test',name:'Alice',role:'member',active:1}],groups:[{id:'g',name:'Project',emails:[]}],events:[]};
 const states=[data,'news','selected',['alice@test'],['g']],calls=[];let saved=0;
 const {View}=view('../components/FeatureAccessSettings.tsx',states),tree=View({api:async(url,options)=>{if(options)calls.push(JSON.parse(options.body));return data;},onSaved:async()=>{saved++;},isEnglish:false});
 find(tree,n=>n.type==='form').props.onSubmit({preventDefault:()=>{}});await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls,[{action:'policySave',feature:'news',mode:'selected',emails:['alice@test'],group_ids:['g'],revision:3}]);assert.equal(saved,1);
 assert.match(renderToStaticMarkup(tree),/管理員永遠保留/);assert.match(renderToStaticMarkup(tree),/全選/);
});
