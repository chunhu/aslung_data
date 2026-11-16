import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function view(file,states=[]){let index=0;const effects=[],updates=new Map();
 const deps={react:{useState:initial=>{const i=index++;return [i<states.length?states[i]:initial,value=>updates.set(i,value)];},useRef:v=>({current:v}),useEffect:f=>effects.push(f)},'react/jsx-runtime':jsx,
 '@/components/PublicSite':{PublicHeader:()=>null,PublicFooter:()=>null},'@/components/ui/button':{Button:'button'},'@/components/ui/input':{Input:'input'},'date-fns-tz':{formatInTimeZone:()=> '2026-11-20T00:00',fromZonedTime:v=>new Date(v+'Z')}};
 const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);return {View:m.exports.default,effects,updates};
}
function find(node,predicate){if(!React.isValidElement(node))return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const found=find(child,predicate);if(found)return found;}return null;}
test('public catalogue offers metadata and application fields without an original download link',()=>{
 const data={total:1,pages:1,rows:[{id:'f',name:'Data.csv',description:'Public description'}]};
 const {View}=view('../components/GuestFilesPublic.tsx',[data,'',1,data.rows[0]]),tree=View({}),html=renderToStaticMarkup(tree);
 assert.match(html,/Public description/);assert.match(html,/申請下載/);for(const name of ['name','email','organization','purpose'])assert.match(html,new RegExp(`name="${name}"`));
 assert.doesNotMatch(html,/download=1|storage_path|external_url/);
 assert.ok(find(tree,n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.required));
});
test('fragment token survives Strict Mode effect replay and never enters the rendered markup',()=>{
 const {View,effects,updates}=view('../components/GuestFilesPublic.tsx'),token='a'.repeat(64);
 const old=globalThis.window;globalThis.window={location:{hash:'#token='+token,pathname:'/file-share'},history:{replaceState:()=>{globalThis.window.location.hash='';}}};
 try{const tree=View({share:true});effects[0]();effects[0]();assert.equal(updates.get(5),token);assert.doesNotMatch(renderToStaticMarkup(tree),new RegExp(token));}
 finally{globalThis.window=old;}
});
test('admin file settings expose opt-in publishing, direct email sharing and all record views',()=>{
 const data={publication:false,requests:{total:1,rows:[]},shares:{total:0,rows:[]},downloads:{total:0,rows:[]}};
 const {View}=view('../components/GuestFilesAdmin.tsx',[data]),tree=View({api:async()=>data,file:{id:'f',name:'Data.csv'},timezone:'Asia/Taipei'}),html=renderToStaticMarkup(tree);
 for(const text of ['公開檔案說明','直接寄送訪客下載連結','下載申請','分享連結','下載紀錄','到期時間','下載次數上限'])assert.match(html,new RegExp(text));
 assert.equal(find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.checked,false);
 assert.match(html,/外部檔案只能限制/);
});
