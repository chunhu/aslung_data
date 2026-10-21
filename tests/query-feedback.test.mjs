import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../app/workspace.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('workspace.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=new Set(['query','reportQueryError','handleExecuteQuery']);
const functions=[];
function visit(node){
  if(ts.isFunctionDeclaration(node)&&names.has(node.name?.text))functions.push(node.getText(ast));
  ts.forEachChild(node,visit);
}
visit(ast);
assert.equal(functions.length,3);
const code=ts.transpileModule(functions.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const params={id:'AL-1143',start:'2026-09-01T00:00:00Z',end:'2026-09-16T00:00:00Z'};
function fixture(request,extra={}){
  const feedback=[],busy=[],pages=[],errors=[];
  const context={isEn:false,calibrationMode:'processed',URLSearchParams,AbortSignal,request,
    setBusy:v=>busy.push(v),setQueryFeedback:v=>feedback.push(v),setPage:v=>pages.push(v),setQueried:()=>{},
    toast:{error:v=>errors.push(v)},batchSelection:false,parameters:()=>params,chosen:null,...extra};
  const api=new Function('context',`const {${Object.keys(context).join(',')}}=context;${code};return {query,handleExecuteQuery};`)(context);
  return {...api,feedback,busy,pages,errors};
}
test('query shows pending then success with count and retains pinned result version',async()=>{
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const f=fixture(async(url,options)=>{
    assert.equal(new URL(url,'http://localhost').searchParams.get('calibration'),'processed');
    assert.ok(options.signal instanceof AbortSignal);return pending;
  });
  const work=f.query(params);
  assert.equal(f.feedback.at(-1).kind,'loading');assert.equal(f.busy.at(-1),true);
  finish({data:[{PM1_G3_final:12}],has_more:true,calibration:'processed',calibration_snapshot:'processed:example'});
  await work;
  assert.equal(f.feedback.at(-1).kind,'success');assert.match(f.feedback.at(-1).message,/1 筆，尚有下一頁/);
  assert.equal(f.busy.at(-1),false);assert.equal(f.pages[0].data[0].PM1_G3_final,12);
});
test('missing calibration coverage remains visible and clears stale results',async()=>{
  const error=new Error('所選區間尚無完整的清理與校正結果：2026-09-01 ～ 2026-09-16');
  const f=fixture(async()=>{throw error;});
  await assert.rejects(()=>f.query(params),error);
  assert.deepEqual(f.feedback.at(-1),{kind:'error',message:error.message});
  assert.equal(f.pages.at(-1),null);assert.equal(f.busy.at(-1),false);
});
test('timeout and invalid form parameters have persistent actionable feedback',async()=>{
  const f=fixture(async()=>{throw new DOMException('timeout','TimeoutError');});
  await assert.rejects(()=>f.query(params));assert.match(f.feedback.at(-1).message,/2 分鐘/);
  const invalid=fixture(async()=>assert.fail('must not request invalid range'),{parameters:()=>{throw new Error('請選擇完整期間');}});
  invalid.handleExecuteQuery();assert.deepEqual(invalid.feedback.at(-1),{kind:'error',message:'請選擇完整期間'});
});
