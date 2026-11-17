import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as fields from '../lib/maintainer-import-fields.mjs';
import {maintainerTable} from '../lib/maintainer-import.mjs';
function fixture(api){let index=0;const values=[];
 const deps={react:{useState:initial=>{const i=index++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];}},'react/jsx-runtime':jsx,
 '@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription'].map(k=>[k,({children})=>React.createElement('div',null,children)])),
 '@/components/ui/button':{Button:'button'},'@/components/ui/input':{Input:'input'},'@/lib/maintainer-import-fields.mjs':fields};
 const code=ts.transpileModule(readFileSync(new URL('../components/MaintainerImportWizard.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,m={exports:{}};
 new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);
 return {values,render(en=false){index=0;return m.exports.default({api,onClose:()=>{},onReload:async()=>{},isEnglish:en});}};
}
function find(node,predicate){if(!React.isValidElement(node))return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const found=find(child,predicate);if(found)return found;}return null;}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('maintainer wizard reads, maps a custom notes column, previews and only writes on explicit confirmation',async()=>{
 const text='Cht_name,mail,Project details\n甲,a@example.test,Custom notes',calls=[],source={text,...maintainerTable(text)};
 const f=fixture(async(url,options)=>{const p=JSON.parse(options.body);calls.push(p);if(p.action==='maintainerImportSource')return source;if(p.action==='maintainerImportPreview')return {counts:{added:1,updated:0,unchanged:0},issues:[],records:[{row:2,name:'甲',email:'a@example.test',notes:'Custom notes',change:'added'}],fingerprint:'reviewed'};return {added:1,updated:0,unchanged:0};});
 let tree=f.render();find(tree,n=>n.type==='button'&&n.props.children==='讀取並對應欄位').props.onClick();await settle();
 tree=f.render();assert.equal(calls.length,1);assert.match(renderToStaticMarkup(tree),/保留既有值/);
 const notes=find(tree,n=>n.type==='label'&&React.Children.toArray(n.props.children).some(c=>c?.props?.children?.[0]==='備註說明'));
 const select=find(notes,n=>n.type==='select');assert.ok(select);select.props.onChange({target:{value:'2'}});
 tree=f.render();find(tree,n=>n.type==='button'&&n.props.children==='預覽匯入結果').props.onClick();await settle();
 tree=f.render();assert.equal(calls[1].mapping.notes,2);assert.equal(calls.length,2);assert.match(renderToStaticMarkup(tree),/Custom notes/);
 find(tree,n=>n.type==='button'&&n.props.children==='確認匯入').props.onClick();await settle();
 assert.equal(calls[2].action,'maintainerImportApply');assert.equal(calls[2].fingerprint,'reviewed');assert.equal(calls[2].text,text);assert.match(renderToStaticMarkup(f.render()),/匯入完成/);
});
test('preview errors disable confirmation, and English controls are available',()=>{
 const f=fixture(async()=>{});f.render();f.values[0]=3;f.values[2]={};f.values[3]={name:0,email:1};
 f.values[4]={counts:{added:0,updated:0,unchanged:0},issues:[{row:9,message:'Invalid row'}],records:[]};
 const tree=f.render(true),html=renderToStaticMarkup(tree);assert.match(html,/Source row.*9/);assert.match(html,/Back to mapping/);
 assert.equal(find(tree,n=>n.type==='button'&&n.props.children==='Confirm import').props.disabled,true);
});
