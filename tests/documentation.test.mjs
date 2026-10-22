import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
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
  const privateManual=stem.includes('Website_User_Manual');
  if(privateManual){
    for(const ext of ['html','md','docx'])assert.equal(existsSync(new URL(`public/docs/${stem}.${ext}`,root)),false,'Website manuals must not be publicly served');
  }else{
    assert.equal(read(`public/docs/${stem}.md`).toString('utf8').replaceAll('\r\n','\n'),source.replaceAll('\r\n','\n'));
    assert.deepEqual(read(`public/docs/${stem}.docx`),read(`docs/${stem}.docx`));
  }
  const html=read(`${privateManual?'docs':'public/docs'}/${stem}.html`).toString('utf8');
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

function view(lang,guide='website',isAdmin=true){
  let index=0;const states=[lang,guide];
  const tag=({children})=>React.createElement('div',null,children);
  const deps={react:{...React,useState:()=>[states[index++],()=>{}],useEffect:()=>{}},'react/jsx-runtime':jsx,
    'lucide-react':{BookOpen:()=>null,Download:()=>null,ExternalLink:()=>null},
    '@/components/ui/button':{Button:tag},'@/components/ui/tabs':{Tabs:tag,TabsList:tag,TabsTrigger:tag}};
  const code=ts.transpileModule(read('components/ApiDocsView.tsx').toString('utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default,{initialLang:lang,isAdmin}));
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
test('non-administrators see only API documentation even with a stale website selection',()=>{
  for(const lang of ['zh','en'])for(const selected of ['website','api']){
    const html=view(lang,selected,false);
    assert.ok(html.includes(`src="/docs/ASLUNG_API_User_Guide_${lang.toUpperCase()}.html"`));
    assert.ok(!html.includes('Website_User_Manual'));
    assert.ok(!html.includes('完整網站說明'));
    assert.ok(!html.includes('Website manual'));
    assert.ok(!html.includes('HOBO'));
  }
  assert.match(read('app/workspace.tsx').toString(),/<ApiDocsView[^>]*isAdmin=\{admin\}/);
});

test('direct website manual URLs require a current system administrator for every language and format',async()=>{
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  let current;
  const server={AppError,identity:async()=>{if(!current)throw new AppError(401,'Login required');return current;},fail:e=>Response.json({error:e.message},{status:e.status||500})};
  const deps={'node:fs/promises':await import('node:fs/promises'),'node:path':await import('node:path'),'@/lib/server':server};
  const code=ts.transpileModule(read('app/docs/[file]/route.ts').toString(),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);
  const get=file=>module.exports.GET(new Request(`http://test/docs/${file}`),{params:Promise.resolve({file})});
  for(const lang of ['ZH','EN'])for(const ext of ['html','md','docx']){
    const file=`ASLUNG_Website_User_Manual_${lang}.${ext}`;
    for(const role of [null,'member','viewer','device_manager','calibration_manager']){
      current=role?{role}:null;
      const r=await get(file);assert.equal(r.status,role?403:401);
      assert.match(r.headers.get('cache-control'),/no-store/);
      assert.ok(!(await r.text()).includes('HOBO'));
    }
    current={role:'admin'};
    const allowed=await get(file);assert.equal(allowed.status,200);
    assert.deepEqual(Buffer.from(await allowed.arrayBuffer()),read(`docs/${file}`));
    assert.match(allowed.headers.get('cache-control'),/private, no-store/);
    current={role:'member'};assert.equal((await get(file)).status,403,'Role downgrade applies on the next request');
  }
  current={role:'admin'};
  for(const file of ['../../.env','ASLUNG_Website_User_Manual_ZH.pdf','ASLUNG_API_User_Guide_ZH.html'])assert.equal((await get(file)).status,404);
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
