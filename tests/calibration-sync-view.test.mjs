import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../components/CalibrationView.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('CalibrationView.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let sync;
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='syncSource')sync=node.getText(ast);ts.forEachChild(node,visit);}
visit(ast);assert.ok(sync);
const code=ts.transpileModule(sync,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

test('syncing one card posts one source ID and does not mark the other card busy',async()=>{
  const calls=[],states=[],messages=[];let finish;
  const hold=new Promise(resolve=>{finish=resolve;});
  const context={syncingRef:{current:new Set()},setSyncing:state=>states.push(state),
    api:async(path,options)=>{calls.push(JSON.parse(options.body));return hold;},
    toast:{error:message=>messages.push(message),info:message=>messages.push(message),success:message=>messages.push(message)},setHistoryRefresh:()=>{},load:async()=>{}};
  const execute=new Function('context',`const {${Object.keys(context).join(',')}}=context;${code};return syncSource;`)(context);
  const one={id:'source-one',name:'Main tab'},two={id:'source-two',name:'Test tab'};
  const running=execute(one);await execute(one);
  assert.deepEqual(calls,[{action:'sync',id:one.id}]);assert.deepEqual([...states.at(-1)],[one.id]);assert.equal(states.at(-1).has(two.id),false);
  finish({status:'UNCHANGED',message:'內容未變更'});await running;
  assert.deepEqual([...states.at(-1)],[]);assert.equal(messages[0],'Main tab：內容未變更');
});

test('independent source requests retain their own busy state when another request finishes',async()=>{
  const requests=new Map(),states=[],messages=[];
  const context={syncingRef:{current:new Set()},setSyncing:state=>states.push(state),api:async(path,options)=>new Promise(resolve=>requests.set(JSON.parse(options.body).id,resolve)),
    toast:{error:message=>messages.push(message),info:message=>messages.push(message),success:message=>messages.push(message)},setHistoryRefresh:()=>{},load:async()=>{}};
  const execute=new Function('context',`const {${Object.keys(context).join(',')}}=context;${code};return syncSource;`)(context);
  const first=execute({id:'one',name:'First'}),second=execute({id:'two',name:'Second'});
  requests.get('one')({status:'FAILED',message:'錯誤摘要\n詳細錯誤'});await first;
  assert.deepEqual([...states.at(-1)],['two']);assert.equal(messages[0],'First：錯誤摘要');
  requests.get('two')({status:'UPDATED',message:'完成'});await second;assert.equal(states.at(-1).size,0);
});
