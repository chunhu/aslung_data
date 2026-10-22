import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import JSZip from 'jszip';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root));
const stems=['Website_User_Manual','API_User_Guide'].flatMap(kind=>['ZH','EN'].map(lang=>`ASLUNG_${kind}_${lang}`));
for(const stem of stems)test(`${stem}: published sources, downloads and heading navigation agree`,async()=>{
  const source=read(`docs/${stem}.md`).toString('utf8');
  assert.equal(read(`public/docs/${stem}.md`).toString('utf8').replaceAll('\r\n','\n'),source.replaceAll('\r\n','\n'));
  assert.deepEqual(read(`public/docs/${stem}.docx`),read(`docs/${stem}.docx`));
  const html=read(`public/docs/${stem}.html`).toString('utf8');
  assert.ok(html.includes(`href="${stem}.docx" download`));
  assert.ok(html.includes(`href="${stem.slice(0,-2)}${stem.endsWith('ZH')?'EN':'ZH'}.html"`));
  const docx=await JSZip.loadAsync(read(`docs/${stem}.docx`));
  const xml=await docx.file('word/document.xml').async('string');
  const headings=source.split('\n').filter(line=>line.startsWith('## '));
  assert.equal((html.match(/<h2 /g)||[]).length,headings.length);
  assert.equal((xml.match(/w:pStyle w:val="Heading1"/g)||[]).length,headings.length);
  for(const term of ['HOBO','NO_FACTOR','INVALID_RAW','S3','calibration_snapshot']){assert.ok(source.includes(term),term);assert.ok(xml.includes(term),term);}
  assert.ok(xml.includes('w:cantSplit'),'Word table rows remain intact');
});

function view(lang,guide='website'){
  let index=0;const states=[lang,guide];
  const tag=({children})=>React.createElement('div',null,children);
  const deps={react:{...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{}},'react/jsx-runtime':jsx,
    'lucide-react':{BookOpen:()=>null,Download:()=>null,ExternalLink:()=>null},
    '@/components/ui/button':{Button:tag},'@/components/ui/tabs':{Tabs:tag,TabsList:tag,TabsTrigger:tag}};
  const code=ts.transpileModule(read('components/ApiDocsView.tsx').toString('utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default,{initialLang:lang}));
}
test('documentation reader selects the matching bilingual manual and API download',()=>{
  for(const lang of ['zh','en'])for(const guide of ['website','api']){
    const stem=`ASLUNG_${guide==='website'?'Website_User_Manual':'API_User_Guide'}_${lang.toUpperCase()}`;
    const html=view(lang,guide);
    assert.ok(html.includes(`src="/docs/${stem}.html"`));
    assert.ok(html.includes(`href="/docs/${stem}.docx"`));
    assert.ok(html.includes('target="_blank"'));
    assert.ok(!html.includes('pd.read_csv(io.StringIO(response.text))'));
  }
});
test('documentation frame exception is limited to static HTML manuals',async()=>{
  const source=read('next.config.ts').toString('utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('module','exports',code)(module,module.exports);
  const rules=await module.exports.default.headers();
  const {tryToParsePath}=await import('next/dist/lib/try-to-parse-path.js');
  function frame(path){let value;for(const rule of rules){const parsed=tryToParsePath(rule.source);assert.ok(!parsed.error);if(new RegExp(parsed.regexStr).test(path)){const header=rule.headers.find(h=>h.key==='X-Frame-Options');if(header)value=header.value;}}return value;}
  for(const stem of stems)assert.equal(frame(`/docs/${stem}.html`),'SAMEORIGIN');
  for(const path of ['/login','/api/data','/docs/manual.docx','/workspace'])assert.equal(frame(path),'DENY');
});
