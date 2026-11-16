import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as content from '../lib/homepage-content.mjs';
import * as options from '../lib/homepage-options.mjs';
import {getHomepageSettings,saveHomepageSettings,publicHomepageContent,publicHomepageSettings} from '../lib/homepage-settings.mjs';
const admin={email:'admin@test'};
function fixture(){const d=new DatabaseSync(':memory:');d.exec("CREATE TABLE members(email TEXT PRIMARY KEY,role TEXT,active INTEGER);INSERT INTO members VALUES('admin@test','admin',1),('member@test','member',1)");return d;}
function load(file,deps){const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,m={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);return m.exports;}
test('legacy display settings migrate without changing visibility, version or save metadata',()=>{
 const d=fixture();try{
  d.exec('CREATE TABLE homepage_settings(id INTEGER PRIMARY KEY,settings TEXT,version INTEGER,updated_by TEXT,updated_at TEXT)');const flags={...options.DEFAULT_HOMEPAGE_SETTINGS,hero_visual:false};
  d.prepare('INSERT INTO homepage_settings VALUES(1,?,8,?,?)').run(JSON.stringify(flags),'original-admin','2026-11-01');
  const state=getHomepageSettings(d,admin);assert.equal(state.version,8);assert.equal(state.updated_by,'original-admin');assert.deepEqual(state.settings,flags);assert.deepEqual(state.content,content.DEFAULT_HOMEPAGE_CONTENT);
  assert.deepEqual(publicHomepageSettings(d),flags);assert.deepEqual(content.normalizeHomepageContent(publicHomepageContent(d)),content.DEFAULT_HOMEPAGE_CONTENT);assert.equal(getHomepageSettings(d,admin).version,8);
 }finally{d.close();}
});
test('bilingual edits, names and flags persist atomically; old clients preserve text and stale saves cannot overwrite it',()=>{
 const d=fixture();try{
  const current=getHomepageSettings(d,admin),draft=content.cloneHomepageContent();draft.features.zh.label='資料特色';draft.features.zh.title='研究服務';draft.features.en.title='Research services';
  const saved=saveHomepageSettings(d,admin,{version:current.version,settings:{...current.settings,join:false},content:draft});assert.equal(saved.version,2);assert.deepEqual(getHomepageSettings(d,admin).content,draft);assert.equal(publicHomepageSettings(d).join,false);
  assert.throws(()=>saveHomepageSettings(d,admin,{...current,content:content.cloneHomepageContent()}),e=>e.status===409);assert.deepEqual(getHomepageSettings(d,admin).content,draft);
  const oldClient=saveHomepageSettings(d,admin,{version:2,settings:current.settings});assert.deepEqual(oldClient.content,draft);assert.equal(oldClient.version,3);
  const reset=saveHomepageSettings(d,admin,{version:3,settings:options.DEFAULT_HOMEPAGE_SETTINGS,content:content.cloneHomepageContent()});assert.deepEqual(reset.content,content.DEFAULT_HOMEPAGE_CONTENT);assert.deepEqual(reset.settings,options.DEFAULT_HOMEPAGE_SETTINGS);
 }finally{d.close();}
});
test('invalid/oversized content is rejected without changing flags or versions; non-admin cannot edit',()=>{
 const d=fixture();try{
  const state=getHomepageSettings(d,admin);
  for(const modify of [c=>{delete c.join;},c=>{c.intro.zh.label=' ';},c=>{c.intro.en.title=123;},c=>{c.join.zh.description='x'.repeat(2001);},c=>{c.extra={};},c=>{c.features.en.title='bad\u0000';},c=>{c.features.fr={};}]){
   const draft=content.cloneHomepageContent();modify(draft);assert.throws(()=>saveHomepageSettings(d,admin,{...state,content:draft}),e=>e.status===400);
  }
  assert.equal(getHomepageSettings(d,admin).version,1);assert.equal(d.isTransaction,false);
  assert.throws(()=>saveHomepageSettings(d,{email:'member@test',role:'admin'},state),e=>e.status===403);
  assert.ok(Buffer.byteLength(JSON.stringify({...state,content:content.cloneHomepageContent()}))<256*1024);
 }finally{d.close();}
});
test('corrupted stored text falls back field-by-field and defaults cannot be mutated through copies',()=>{
 const d=fixture();try{
  getHomepageSettings(d,admin);d.prepare('UPDATE homepage_settings SET content=? WHERE id=1').run(JSON.stringify({features:{zh:{title:'保留自訂標題',description:42}}}));
  const result=publicHomepageContent(d);assert.equal(result.features.zh.title,'保留自訂標題');assert.equal(result.features.zh.description,content.DEFAULT_HOMEPAGE_CONTENT.features.zh.description);
  result.features.zh.title='Mutated';assert.equal(publicHomepageContent(d).features.zh.title,'保留自訂標題');assert.notEqual(content.DEFAULT_HOMEPAGE_CONTENT.features.zh.title,'Mutated');
 }finally{d.close();}
});
test('disabled sections and dependent device captions are excluded from public serialized content',()=>{
 const d=fixture();try{
  const current=getHomepageSettings(d,admin),draft=content.cloneHomepageContent();draft.features.zh.title='HIDDEN_CUSTOM_HEADING';draft.hero_device_label.zh.text='HIDDEN_DEVICE_CAPTION';
  saveHomepageSettings(d,admin,{...current,settings:{...current.settings,features:false,hero_visual:false,hero_device_label:true},content:draft});
  const serialized=JSON.stringify(publicHomepageContent(d));assert.ok(!serialized.includes('HIDDEN_CUSTOM_HEADING'));assert.ok(!serialized.includes('HIDDEN_DEVICE_CAPTION'));assert.equal(publicHomepageContent(d).features,undefined);
  assert.equal(getHomepageSettings(d,admin).content.features.zh.title,'HIDDEN_CUSTOM_HEADING');
 }finally{d.close();}
});
function publicView(lang){return load('../components/PublicSite.tsx',{'react/jsx-runtime':jsx,'@/components/LanguageSwitcher':{default:()=>null},'@/components/useAppLanguage':{default:()=>lang},'@/components/RichPostBody':{default:()=>null},'@/lib/homepage-options.mjs':options,'@/lib/homepage-content.mjs':content,'lucide-react':Object.fromEntries(['Activity','ArrowRight','Database','ShieldCheck','SlidersHorizontal','FileText','ArrowUpRight','Users','CheckCircle2'].map(key=>[key,()=>null]))}).LandingPage;}
test('public sections render edited headings, text, device names and steps in the selected language with HTML escaped',()=>{
 const draft=content.cloneHomepageContent();for(const section of content.HOMEPAGE_CONTENT_SECTIONS)for(const field of section.fields){draft[section.key].zh[field.key]='ZH_'+section.key+'_'+field.key;draft[section.key].en[field.key]='EN_'+section.key+'_'+field.key;}
 draft.intro.zh.description='<script>alert(1)</script>';
 const settings={...options.DEFAULT_HOMEPAGE_SETTINGS,hero_device_label:true},zh=renderToStaticMarkup(React.createElement(publicView('zh-TW'),{content:draft,settings})),en=renderToStaticMarkup(React.createElement(publicView('en'),{content:draft,settings}));
 for(const [section,key] of [['intro','title'],['hero_visual','title'],['hero_device_label','text'],['data_sources','source_0'],['features','card_2_body'],['public_posts','empty_title'],['join','step_2_body']]){assert.ok(zh.includes('ZH_'+section+'_'+key));assert.ok(en.includes('EN_'+section+'_'+key));}
 assert.match(zh,/&lt;script&gt;/);assert.ok(!zh.includes('<script>'));assert.ok(!en.includes('ZH_'));assert.match(zh,/href="\/login"/);assert.match(zh,/href="\/register"/);
});
function find(node,predicate){if(!React.isValidElement(node))return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const found=find(child,predicate);if(found)return found;}return null;}
test('editor resets a single section or all sections in the draft, then sends both languages only on Save',async()=>{
 const draft=content.cloneHomepageContent();draft.hero_visual.zh.title='Custom illustration';draft.features.zh.title='Custom features';
 const snapshot={version:4,settings:{...options.DEFAULT_HOMEPAGE_SETTINGS,hero_visual:false},content:draft},slots=[snapshot,snapshot.settings,content.cloneHomepageContent(draft),false,false,'',''],calls=[];let i=0;
 const deps={'react':{useState:()=>{const n=i++;return [slots[n],v=>{slots[n]=typeof v==='function'?v(slots[n]):v;}];},useRef:()=>({current:0}),useEffect:()=>{}},'react/jsx-runtime':jsx,'@/lib/homepage-options.mjs':options,'@/lib/homepage-content.mjs':content,'@/components/ui/button':{Button:'button'},'@/components/ui/input':{Input:'input'}};
 const View=load('../components/HomepageSettings.tsx',deps).default,props={api:async(url,init)=>{const p=JSON.parse(init.body);calls.push(p);return {...p,version:5};},isEnglish:false,formatTime:v=>v},render=()=>{i=0;return View(props);},old=globalThis.window;globalThis.window={confirm:()=>true};
 try{
  let tree=render();const section=find(tree,n=>n.type==='details'&&React.Children.toArray(n.props.children)[0]?.props.children[0]==='首頁主視覺示意圖');assert.ok(section);
  find(section,n=>n.type==='button').props.onClick();assert.equal(slots[2].hero_visual.zh.title,content.DEFAULT_HOMEPAGE_CONTENT.hero_visual.zh.title);assert.equal(slots[2].features.zh.title,'Custom features');assert.equal(slots[1].hero_visual,true);assert.equal(calls.length,0);
  tree=render();find(tree,n=>n.type==='button'&&n.props.children==='全部恢復預設（需儲存）').props.onClick();assert.deepEqual(slots[2],content.DEFAULT_HOMEPAGE_CONTENT);assert.equal(calls.length,0);
  tree=render();await find(tree,n=>n.type==='form').props.onSubmit({preventDefault:()=>{}});assert.equal(calls.length,1);assert.deepEqual(calls[0].content,content.DEFAULT_HOMEPAGE_CONTENT);assert.equal(calls[0].version,4);
 }finally{globalThis.window=old;}
});
