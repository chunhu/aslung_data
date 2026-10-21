import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {fieldGuideHtml,writeFieldGuides} from '../scripts/generate-data-field-guide.mjs';

test('both offline guides match their source and contain every raw alias and scientific quality flag',async()=>{
  await writeFieldGuides({check:true});
  const raw=readFileSync(new URL('../lib/processing-raw.mjs',import.meta.url),'utf8').split('export function processingPool')[0];
  const aliases=[...raw.matchAll(/AS\s+(?:`([^`]+)`|([A-Za-z0-9_.]+))/g)].map(m=>m[1]||m[2]);
  const scientific=readFileSync(new URL('../lib/measurement-processing.mjs',import.meta.url),'utf8');
  const flags=[...scientific.matchAll(/flag\([^\n;]+/g)].flatMap(match=>[...match[0].matchAll(/'([A-Z_]+)'/g)].map(m=>m[1]));
  assert.ok(flags.includes('GHOST_PEAK'));assert.ok(aliases.includes('battery'));
  for(const lang of ['ZH','EN']){
    const html=fieldGuideHtml(lang);
    for(const code of [...aliases,...flags,'_processing_job_id','_processing_up_limit','_background_status','_quality','INSUFFICIENT_CONTEXT','INVALID_RESULT','six-rules-2','all-fields-1'])assert.ok(html.includes(code),`${lang}: ${code}`);
    assert.match(html,new RegExp(`href="./ASLUNG_Data_Fields_${lang}.html" download=`));
    assert.match(html,/window.print\(\)/);assert.match(html,/@media print/);
    assert.ok(!/\b(?:src|href)="https?:/.test(html),'offline guide must not depend on external assets');
  }
});

test('data query documentation button opens the selected language in a new tab without submitting a query',()=>{
  const source=readFileSync(new URL('../components/DataFieldGuideLink.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};
  const deps={'react/jsx-runtime':jsx,'lucide-react':{FileText:()=>null},'@/components/ui/button':{Button:({children})=>children}};
  new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);
  for(const [isEnglish,lang,label] of [[false,'ZH','欄位資料說明'],[true,'EN','Field documentation']]){
    const html=renderToStaticMarkup(React.createElement(module.exports.default,{isEnglish}));
    assert.ok(html.includes(`/docs/ASLUNG_Data_Fields_${lang}.html`));assert.ok(html.includes(label));assert.match(html,/target="_blank"/);assert.match(html,/noopener noreferrer/);assert.ok(!html.includes('<button'));
  }
  const workspace=readFileSync(new URL('../app/workspace.tsx',import.meta.url),'utf8');
  const start=workspace.indexOf(' {section==="data"&&<><section className="panel query-panel">');
  assert.ok(workspace.slice(start,workspace.indexOf('<form onSubmit=',start)).includes('<DataFieldGuideLink isEnglish={isEn}/>'));
});
