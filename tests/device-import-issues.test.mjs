import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const source=readFileSync(new URL('../components/DeviceImportIssues.tsx',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const module={exports:{}};
new Function('require','module','exports',code)(name=>{assert.equal(name,'react/jsx-runtime');return jsx;},module,module.exports);
const View=module.exports.default;

test('all blocking errors appear before 199 warnings, with source rows and warnings collapsed',()=>{
  const warnings=Array.from({length:199},(_,i)=>({level:'warning',row:i+1,message:'負責人尚未建檔'}));
  const issues=[...warnings,{level:'error',row:901,message:'結束日期格式錯誤'},{level:'error',row:205,message:'設備編號遺漏'}];
  const html=renderToStaticMarkup(React.createElement(View,{issues}));
  assert.ok(html.includes('2 項錯誤、199 項提醒'));assert.ok(html.includes('第 901 列'));assert.ok(html.includes('第 205 列'));
  assert.ok(html.indexOf('設備編號遺漏')<html.indexOf('結束日期格式錯誤'));assert.ok(html.indexOf('結束日期格式錯誤')<html.indexOf('負責人尚未建檔'));
  assert.match(html,/role="alert"/);assert.ok(!html.includes('<details open'));
  assert.equal(issues[0],warnings[0]);assert.equal(issues[199].row,901);
});

test('more than 100 errors remain visible, and warnings alone do not imply import is blocked',()=>{
  const issues=Array.from({length:150},(_,i)=>({level:'error',row:i+2,message:`錯誤-${i}`}));
  let html=renderToStaticMarkup(React.createElement(View,{issues}));assert.ok(html.includes('錯誤-149'));assert.ok(html.includes('第 151 列'));assert.ok(html.includes('全部錯誤'));
  html=renderToStaticMarkup(React.createElement(View,{issues:[{level:'warning',row:11,message:'負責人尚未建檔'}]}));
  assert.ok(html.includes('不阻擋匯入'));assert.ok(html.includes('<details open'));assert.ok(!html.includes('role="alert"'));
  assert.equal(renderToStaticMarkup(React.createElement(View,{issues:[]})),'');
});
