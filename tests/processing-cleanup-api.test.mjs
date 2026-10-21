import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

test('cleanup API restricts preview, confirm, audit and retries to admins and checks write origin',async()=>{
  let role='member',guard=true,opened=0;const calls=[];
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const methods={cleanupStatus:()=>{calls.push('status');return {counts:[],tasks:[]};},previewCleanup:async(d,p)=>{calls.push(['preview',p]);return {id:'plan'};},
    confirmCleanup:async(d,p)=>{calls.push(['confirm',p]);return {ok:true};},retryCleanup:(d,id)=>calls.push(['retry',id])};
  const deps={'@/lib/server':{AppError,identity:async()=>({role,email:'admin@test'}),writeGuard:()=>{if(!guard)throw new AppError(403,'origin');},fail:e=>Response.json({error:e.message},{status:e.status||500})},
    '@/lib/store.mjs':{getConnection:()=>{opened++;return {}; }},'@/lib/processing-cleanup.mjs':methods};
  const code=ts.transpileModule(readFileSync(new URL('../app/api/processing/cleanup/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);
  const get=()=>module.exports.GET(new Request('http://test/api/processing/cleanup'));
  const post=body=>module.exports.POST(new Request('http://test/api/processing/cleanup',{method:'POST',body:JSON.stringify(body)}));
  for(role of ['member','viewer','calibration_manager']){assert.equal((await get()).status,403);assert.equal((await post({action:'preview'})).status,403);}
  assert.equal(opened,0);assert.equal(calls.length,0);
  role='admin';guard=false;assert.equal((await post({action:'confirm'})).status,403);assert.equal(calls.length,0);guard=true;
  assert.equal((await post({action:'preview',filters:[]})).status,400);assert.equal((await post(null)).status,400);
  const preview=await post({action:'preview',filters:{device:'AL-1'}});assert.equal(preview.status,200);assert.match(preview.headers.get('Cache-Control'),/no-store/);
  assert.deepEqual(calls.at(-1),['preview',{actor:'admin@test',filters:{device:'AL-1'}}]);
  await post({action:'confirm',id:'plan',confirmation:'DELETE',pauseSchedules:true});assert.deepEqual(calls.at(-1),['confirm',{id:'plan',actor:'admin@test',confirmation:'DELETE',pauseSchedules:true}]);
  await post({action:'retry',id:'task'});assert.deepEqual(calls.at(-1),['retry','task']);assert.equal((await get()).status,200);
  methods.confirmCleanup=async()=>{throw Object.assign(new Error('expired'),{status:409});};assert.equal((await post({action:'confirm'})).status,409);
  methods.previewCleanup=async()=>{throw Object.assign(new Error('Access Denied'),{$metadata:{httpStatusCode:403}});};
  const denied=await post({action:'preview'});assert.equal(denied.status,403);assert.match((await denied.json()).error,/EC2 Role/);
});
