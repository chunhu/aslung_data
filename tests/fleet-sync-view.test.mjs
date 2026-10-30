import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as imports from '../lib/fleet-import.mjs';
const code=ts.transpileModule(readFileSync(new URL('../components/DeviceImportWizard.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const editorCode=ts.transpileModule(readFileSync(new URL('../components/FleetScheduleEditor.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function view(states=[]){let index=0;const updates=new Map(),tag=name=>({children,...props})=>React.createElement(name,Object.fromEntries(Object.entries(props).filter(([key])=>['disabled','aria-label','min','max','type'].includes(key))),children);
 const deps={react:{...React,useState:initial=>{const i=index++;return [i<states.length?states[i]:initial,value=>updates.set(i,value)];},useEffect:()=>{}},'react/jsx-runtime':jsx,
 'lucide-react':Object.fromEntries(['ArrowLeft','ArrowRight','CheckCircle2','CloudDownload','FileSpreadsheet','Upload','TriangleAlert'].map(k=>[k,()=>null])),
 '@/components/ui/button':{Button:tag('button')},'@/components/ui/input':{Input:tag('input')},'@/components/ui/textarea':{Textarea:tag('textarea')},
 '@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription'].map(k=>[k,tag('div')])),
 '@/lib/fleet-import.mjs':imports,sonner:{toast:{success:()=>{}}},'@/components/DeviceImportIssues':{default:()=>null},'@/components/FleetSyncSchedules':{default:()=>React.createElement('p',null,'管理既有定期同步排程')}};
 const editor={exports:{}};new Function('require','module','exports',editorCode)(name=>deps[name],editor,editor.exports);deps['@/components/FleetScheduleEditor']=editor.exports;
 const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);return {View:module.exports.default,updates,Editor:editor.exports.default};}
function find(node,predicate){if(!React.isValidElement(node))return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const r=find(child,predicate);if(r)return r;}return null;}
const url='https://docs.google.com/spreadsheets/d/example/edit?gid=1',text='lab_id,device_id,device_type,start_date\nN1,AL-1,aslung,2026-01-01',parsed=imports.parseImportTable(text),preview={fingerprint:'preview-hash',records:[{row:2}],canApply:true,issues:[]};
const base=[1,'google',text,url,parsed,parsed.mapping,true,null,false,'',true,'120',false,0,'interval','02:00','1,2,3,4,5'];
const props={mode:'google',onClose:()=>{},onReload:async()=>{},api:async()=>assert.fail('unexpected request')};
test('Google import offers an opt-in scheduler, custom minute limits and existing schedule management',()=>{
 const {View}=view(base);const html=renderToStaticMarkup(View(props));
 assert.match(html,/確認匯入後啟用定期同步資料/);assert.match(html,/管理既有定期同步排程/);
 assert.match(html,/min="1"/);assert.match(html,/max="10080"/);
 const paste=[...base];paste[1]='paste';const {View:Paste}=view(paste);assert.ok(!renderToStaticMarkup(Paste(props)).includes('確認匯入後啟用定期同步資料'));
});
test('confirming the preview saves the exact source, mapping and selected schedule period in the import request',async()=>{
 const states=[...base];states[0]=3;states[7]=preview;const calls=[];const {View}=view(states);
 const tree=View({...props,api:async(path,options)=>{calls.push(JSON.parse(options.body));return {added:1,updated:0,unchanged:0};}});
 find(tree,n=>n.props.children==='確認套用 1 筆').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[{action:'applyImport',text,mapping:parsed.mapping,onlyAslung:true,fingerprint:'preview-hash',schedule:{url,enabled:true,intervalMins:120,scheduleType:'interval',scheduleTime:'02:00',scheduleDays:'1,2,3,4,5'}}]);
});
test('schedule editor switches modes, displays weekly day selection and uses Taipei time inputs',()=>{
 const {Editor}=view(base),updates=[],value={scheduleType:'interval',scheduleTime:'05:00',scheduleDays:'1,3',intervalMins:'60'};
 let tree=Editor({value,onChange:v=>updates.push(v)});find(tree,n=>React.Children.toArray(n.props.children).includes('每天固定時間')).props.onClick();assert.equal(updates[0].scheduleType,'daily');
 tree=Editor({value:{...value,scheduleType:'weekly'},onChange:v=>updates.push(v)});
 const html=renderToStaticMarkup(tree);assert.match(html,/每週執行同步日期/);assert.match(html,/週日/);assert.match(html,/Asia\/Taipei/);
 assert.match(html,/type="time"/);assert.doesNotMatch(html,/同步間隔（分鐘）/);
 find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:false}});assert.equal(updates.at(-1).scheduleDays,'3');
});
