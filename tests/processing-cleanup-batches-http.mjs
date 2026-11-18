// Build first. Disposable SQLite, no worker and no source MySQL/S3 operations.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {hashPassword,tokenHash} from '../lib/passwords.mjs';
import {ensureCleanupSchema,runNextCleanup,cleanupStatus} from '../lib/processing-cleanup.mjs';
const dir=mkdtempSync(join(tmpdir(),'aslung-cleanup-http-'));process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {getConnection}=await import('../lib/store.mjs');const d=getConnection(),cookies={};
for(const role of ['admin','member','calibration_manager']){const token=randomBytes(32).toString('hex');d.prepare('INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,?,1,?)').run(role+'@test.invalid',role,role,role,role,await hashPassword('Local-Archive-Test-2026!'));d.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),role+'@test.invalid',Date.now()+3600000);cookies[role]='aslung_session='+token;}
d.prepare('INSERT INTO devices(id,name) VALUES(?,?)').run('AL-CLEANUP-01','Cleanup fixture');ensureCleanupSchema(d);
d.exec('BEGIN');for(let i=0;i<1001;i++){const id=randomUUID(),start=new Date(Date.UTC(2020,0,1+i)),end=new Date(+start+86400000);d.prepare("INSERT INTO processing_jobs(id,device,start,end,recipe,factors,cache_key,actor,created_at,data_kind) VALUES(?,'AL-CLEANUP-01',?,?,'{}','[]',?,'test',?,'raw')").run(id,start.toISOString(),end.toISOString(),id,start.toISOString());}d.exec('COMMIT');
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin=`http://127.0.0.1:${port}`,cwd=resolve('.next/standalone');
for(const [target,source] of [['public','public'],['.next/static','.next/static']])if(!existsSync(join(cwd,target)))symlinkSync(resolve(source),join(cwd,target),'dir');
const child=spawn(process.execPath,[join(cwd,'server.js')],{cwd,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin,BACKUP_PATH:join(dir,'backups'),CALIBRATION_RESULT_DIR:join(dir,'results'),CALIBRATION_STORAGE:'s3',S3_BUCKET:'aslung-test-bucket',AWS_REGION:'ap-northeast-1'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
const get=(path,role='admin')=>fetch(origin+path,{headers:{Cookie:cookies[role]||''}});
const post=(p,role='admin',source=origin)=>fetch(origin+'/api/processing/cleanup',{method:'POST',headers:{Origin:source,Cookie:cookies[role]||'','Content-Type':'application/json'},body:JSON.stringify(p)});
let stopping=false;async function stop(){if(stopping)return;stopping=true;child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));d.close();rmSync(dir,{recursive:true,force:true});}
process.once('SIGTERM',()=>void stop().then(()=>process.exit(0)));
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,logs);
 const path='/api/processing/cleanup',scope={action:'preview',batchMode:true,filters:{kind:'raw'}};
 assert.equal((await get(path,'anonymous')).status,401);
 for(const role of ['member','calibration_manager']){assert.equal((await get(path,role)).status,403);assert.equal((await post(scope,role)).status,403);assert.equal((await post({action:'control',id:randomUUID(),operation:'cancel'},role)).status,403);}
 assert.equal((await post(scope,'admin','https://foreign.invalid')).status,403);
 let response=await post(scope);assert.equal(response.status,200,await response.clone().text());const plan=await response.json();assert.equal(plan.totals.jobs,1001);assert.equal(plan.totals.batches,3);assert.equal(plan.items.length,50);
 const confirmation={action:'confirm',id:plan.id,confirmation:'DELETE',pauseSchedules:false};assert.equal((await post({...confirmation,confirmation:'wrong'})).status,400);
 response=await post(confirmation);assert.equal(response.status,200,await response.clone().text());assert.equal((await (await post(confirmation)).json()).reused,true);
 assert.ok(d.prepare('SELECT backup_path FROM processing_cleanup_plans WHERE id=?').get(plan.id).backup_path.startsWith(join(dir,'backups')));
 const control=(id,operation)=>post({action:'control',id,operation}),opts={root:join(dir,'results'),inventory:async()=>[],purge:async()=>{}};
 assert.equal((await control(plan.id,'pause')).status,200);assert.equal(await runNextCleanup(d,opts),null);assert.equal((await control(plan.id,'resume')).status,200);
 await runNextCleanup(d,opts);let state=await (await get(path)).json();assert.equal(state.batches[0].done,1);assert.equal(state.batches[0].current_batch,1);
 assert.equal((await control(plan.id,'cancel')).status,200);state=await (await get(path)).json();assert.equal(state.batches[0].state,'CANCELLED');assert.equal(state.batches[0].cancelled,1000);assert.equal((await control(plan.id,'resume')).status,409);
 // Leave a synthetic paused run for optional browser verification.
 const next=await (await post(scope)).json();assert.equal(next.totals.jobs,1000);assert.equal((await post({...confirmation,id:next.id})).status,200);await runNextCleanup(d,opts);assert.equal((await control(next.id,'pause')).status,200);
 console.log('PASS: deployed >500 preview, one confirmation/backup, fixed scope, admin/origin guards, durable progress, pause/resume and cancellation. Only disposable fixture files were deleted; no source MySQL or S3 operations.');
 if(process.argv.includes('--preview')){
 d.exec('BEGIN');for(const table of ['processing_cleanup_batch_items','processing_cleanup_batch_events','processing_cleanup_tasks','processing_cleanup_batches','processing_cleanup_plans','processing_jobs'])d.exec('DELETE FROM '+table);
 for(let i=0;i<1201;i++){const id=randomUUID(),start=new Date(Date.UTC(2020,0,1+i)),end=new Date(+start+86400000);d.prepare("INSERT INTO processing_jobs(id,device,start,end,recipe,factors,cache_key,actor,created_at,data_kind) VALUES(?,'AL-CLEANUP-01',?,?,'{}','[]',?,'test',?,'raw')").run(id,start.toISOString(),end.toISOString(),id,start.toISOString());}d.exec('COMMIT');
 console.log('PREVIEW '+origin+' PID '+process.pid);await new Promise(()=>{});}
}catch(e){console.error(logs);throw e;}finally{await stop();}
