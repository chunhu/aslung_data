import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as language from '../lib/language.mjs';

test('only a Traditional Chinese primary browser language defaults to Chinese',()=>{
  for(const tag of ['zh-TW','zh-Hant','zh-Hant-TW','zh-HK','zh-MO','ZH_tw'])assert.equal(language.browserDisplayLanguage(tag),'zh-TW',tag);
  for(const tag of ['en-US','ja','fr','zh-CN','zh-SG','zh-Hans','zh-Hans-TW','zh','',undefined])assert.equal(language.browserDisplayLanguage(tag),'en',String(tag));
  assert.equal(language.resolveDisplayLanguage('',{languages:['en-US','zh-TW'],language:'zh-TW'}),'en');
  assert.equal(language.resolveDisplayLanguage('',{languages:['zh-TW','en-US']}),'zh-TW');
});
test('explicit links and remembered choices override the browser; stale translation cookies do not',()=>{
  assert.equal(language.resolveDisplayLanguage('googtrans=/zh-TW/en',{language:'zh-TW'}),'zh-TW');
  assert.equal(language.resolveDisplayLanguage('aslung_language=en',{language:'zh-TW'}),'en');
  assert.equal(language.resolveDisplayLanguage('aslung_language=zh-TW',{language:'en-US'}),'zh-TW');
  assert.equal(language.resolveDisplayLanguage('aslung_language=en',{language:'en-US'},'zh-TW'),'zh-TW');
  assert.equal(language.resolveDisplayLanguage('aslung_language=%notvalid',{language:'zh-TW'}),'zh-TW');
  assert.equal(language.resolveDisplayLanguage('aslung_language=fr',{language:'en-US'}),'en');
});
function compile(path,deps){
  const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);return module.exports.default;
}
function environment(url='http://local.test/register?lang=en#form'){
  const old=new Map(['window','document','location','CustomEvent','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const jar=new Map(),writes=[],listeners=new Map();let reloads=0;
  const location=new URL(url),document={documentElement:{lang:'zh-Hant'}};
  Object.defineProperty(document,'cookie',{get:()=>[...jar].map(([k,v])=>k+'='+v).join('; '),set:value=>{writes.push(value);const [pair]=value.split(';'),split=pair.indexOf('='),name=pair.slice(0,split),text=pair.slice(split+1);if(value.includes('max-age=0'))jar.delete(name);else jar.set(name,text);}});
  const window={location:{get href(){return location.href;},reload:()=>{reloads++;}},history:{replaceState:(_a,_b,url)=>{location.href=String(url);}},
    addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn),dispatchEvent:event=>{for(const fn of listeners.get(event.type)||[])fn(event);}};
  for(const [key,value] of Object.entries({window,document,location,navigator:{languages:['zh-TW']},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}}))Object.defineProperty(globalThis,key,{configurable:true,value});
  return {jar,writes,location,document,window,reloads:()=>reloads,restore(){for(const [key,descriptor]of old)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}};
}
test('language button shows the other language, has no dropdown, and preserves forms when switching',()=>{
  const env=environment();let current='en';
  try{
    const Switch=compile('../components/LanguageSwitcher.tsx',{
      react:{useEffect:()=>{}},'react/jsx-runtime':jsx,'@/components/useAppLanguage':{default:()=>current},'@/lib/language.mjs':language,
      '@/components/ui/button':{Button:({children,...p})=>React.createElement('button',{type:p.type,'aria-label':p['aria-label']},children)}
    });
    const tree=Switch({translatePage:false,reloadOnChange:false});
    const html=renderToStaticMarkup(tree);assert.match(html,/>中文<\/button>/);assert.doesNotMatch(html,/<select/);assert.match(html,/translate="no"/);
    tree.props.children[1].props.onClick();
    assert.equal(env.jar.get('aslung_language'),'zh-TW');assert.equal(env.location.searchParams.get('lang'),'zh-TW');assert.equal(env.location.hash,'#form');assert.equal(env.document.documentElement.lang,'zh-Hant');assert.equal(env.reloads(),0);
    current='zh-TW';const chinese=Switch({translatePage:false});assert.match(renderToStaticMarkup(chinese),/>English<\/button>/);
    chinese.props.children[1].props.onClick();assert.equal(env.jar.get('aslung_language'),'en');assert.equal(env.reloads(),1);
  }finally{env.restore();}
});
test('default detection updates app language without persisting an automatic choice',()=>{
  const env=environment('http://local.test/login');let state,effect;
  try{
    const hook=compile('../components/useAppLanguage.ts',{react:{useState:()=>[null,value=>{state=value;}],useEffect:fn=>{effect=fn;}},'@/lib/language.mjs':language});
    hook();const cleanup=effect();
    assert.equal(state,'zh-TW');assert.equal(env.jar.has('aslung_language'),false);assert.equal(env.jar.get('googtrans'),'/zh-TW/zh-TW');
    language.applyDisplayLanguage('en',true);assert.equal(state,'en');assert.equal(env.document.documentElement.lang,'en');cleanup();
  }finally{env.restore();}
});
