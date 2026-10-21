import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

function render(file,states,extra={}){
  let index=0;
  const tag=name=>({children,disabled,role})=>React.createElement(name,{disabled,role},children);
  const deps={react:{...React,useState:value=>[index<states.length?states[index++]:value,()=>{}],useEffect:()=>{},useCallback:fn=>fn,useRef:value=>({current:value})},
    'react/jsx-runtime':jsx,'@/components/ui/button':{Button:tag('button')},'@/components/ui/input':{Input:tag('input')},'@/components/ui/label':{Label:tag('label')},
    '@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription'].map(name=>[name,tag('div')])),
    '@/lib/measurement-processing.mjs':{DEFAULT_UP_LIMIT:3},sonner:{toast:{}},
    '@/components/ProcessingJobDetails':{default:()=>null,storageLabel:()=> 'S3 已驗證'},'@/components/ProcessingCleanup':{default:()=>null}};
  const code=ts.transpileModule(readFileSync(new URL('../components/'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default,{api:()=>assert.fail('render must not read results'),isEnglish:false,formatTime:value=>value,onClose:()=>{},...extra}));
}
const job={id:'job-1',device:'AL-1143',start:'2026-10-01T00:00:00Z',end:'2026-10-02T00:00:00Z',status:'COMPLETED',rows_done:1419,
  recipe:{version:'six-rules-2',rawSchema:'all-fields-1',upLimit:3},summary:{flags:{INVALID_RAW:1},incompleteContext:0},upload_status:'STORED',attempts:1};
test('history renders filters, page totals and details actions without duplicate previews or downloads',()=>{
  const filters={device:'',from:'',to:'',status:''};
  const data={jobs:[job],schedules:[],global:{enabled:0,up_limit:3},pagination:{total:105,page:2,pages:6}};
  const html=render('ProcessingJobs.tsx',[data,'',false,'','','','3','',filters,filters,2,false,'3',false]);
  for(const text of ['校正工作記錄','結束日期（含當日）','工作狀態','詳細資料','共 105 筆工作','第 2／6 頁','AL-1143'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('CSV ZIP'));assert.ok(!html.includes('品質摘要'));assert.ok(!html.includes('結果查詢'));
});
test('details consolidate versions, quality, storage and job download without automatically reading preview rows',()=>{
  const html=render('ProcessingJobDetails.tsx',[job,'',null,'',false,0,'G3'],{id:job.id});
  for(const text of ['品質摘要','INVALID_RAW','six-rules-2 / all-fields-1','S3 已驗證','背景樣本不足筆數','載入結果預覽','下載此工作（CSV ZIP）'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('<table'));assert.ok(html.includes('download=1'));
});

test('cleanup confirmation shows permanent scope, sizes and schedule option and requires DELETE before enabling',()=>{
  const plan={filters:{device:'AL-1143'},totals:{jobs:1,excluded:0,localFiles:1,localBytes:1024,s3Versions:2,s3Bytes:2048},items:[{id:'job-1',device:'AL-1143',start:job.start,end:job.end,localCount:1,remoteCount:2}]};
  const states=[{counts:[],tasks:[]},'',true,plan,false,'',true,''];
  let html=render('ProcessingCleanup.tsx',states,{filters:{},onChange:()=>{}});
  for(const text of ['確認清除校正成果','本機檔案／大小','S3 版本及刪除標記／大小','停用全域排程','保留原始量測','輸入 DELETE 確認'])assert.ok(html.includes(text),text);
  assert.match(html,/<button disabled="">確認永久清除<\/button>/);
  states[5]='DELETE';html=render('ProcessingCleanup.tsx',states,{filters:{},onChange:()=>{}});
  assert.match(html,/<button>確認永久清除<\/button>/);
});
