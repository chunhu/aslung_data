// Build first. Disposable SQLite, no worker and no source MySQL/S3 operations.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {hashPassword,tokenHash} from '../lib/passwords.mjs';
import {enqueueProcessing} from '../lib/processing-jobs.mjs';
const dir=mkdtempSync(join(tmpdir(),'aslung-archive-http-'));process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {getConnection}=await import('../lib/store.mjs');const d=getConnection(),cookies={};
for(const role of ['admin','member','calibration_manager']){const token=randomBytes(32).toString('hex');d.prepare('INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,?,1,?)').run(role+'@test.invalid',role,role,role,role,await hashPassword('Local-Archive-Test-2026!'));d.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),role+'@test.invalid',Date.now()+3600000);cookies[role]='aslung_session='+token;}
for(const device of ['AL-ARCHIVE-01','AL-ARCHIVE-02']){d.prepare('INSERT INTO devices(id,name) VALUES(?,?)').run(device,'Archive fixture');for(const day of ['2026-09-01','2026-10-01'])enqueueProcessing(d,{device,start:day+'T00:00:00+08:00',end:new Date(Date.parse(day+'T00:00:00+08:00')+86400000).toISOString(),actor:'test',dataKind:'raw'});}
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin=`http://127.0.0.1:${port}`,cwd=resolve('.next/standalone');
for(const [target,source] of [['public','public'],['.next/static','.next/static']])if(!existsSync(join(cwd,target)))symlinkSync(resolve(source),join(cwd,target),'dir');
const child=spawn(process.execPath,[join(cwd,'server.js')],{cwd,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin,CALIBRATION_STORAGE:'s3',S3_BUCKET:'aslung-test-bucket',AWS_REGION:'ap-northeast-1'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
const get=(path,role='admin')=>fetch(origin+path,{headers:{Cookie:cookies[role]||''}});
const post=(p,role='admin',source=origin)=>fetch(origin+'/api/archive-automation',{method:'POST',headers:{Origin:source,Cookie:cookies[role]||'','Content-Type':'application/json'},body:JSON.stringify(p)});
let stopping=false;async function stop(){if(stopping)return;stopping=true;child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));d.close();rmSync(dir,{recursive:true,force:true});}
process.once('SIGTERM',()=>void stop().then(()=>process.exit(0)));
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,logs);
 assert.equal((await get('/api/archive-automation','anonymous')).status,401);
 const settings={action:'save',monthlyEnabled:true,lateEnabled:true,monthDay:5};
 for(const role of ['member','calibration_manager']){assert.equal((await get('/api/archive-automation',role)).status,403);assert.equal((await post(settings,role)).status,403);assert.equal((await get('/api/manage?scope=archives',role)).status,403);}
 assert.equal((await post(settings,'admin','https://foreign.invalid')).status,403);assert.equal((await post({...settings,monthDay:0})).status,400);
 assert.equal((await post(settings)).status,200);let state=await (await get('/api/archive-automation')).json();assert.equal(state.settings.monthly_enabled,1);assert.equal(state.settings.late_enabled,1);
 assert.equal((await get('/api/manage?scope=archives')).status,200);
 const list=await (await get('/api/processing?kind=raw&device=AL-ARCHIVE-01&from=2026-10-01&to=2026-10-01')).json();assert.equal(list.jobs.length,1);assert.equal(list.pagination.total,1);assert.equal(list.jobs[0].device,'AL-ARCHIVE-01');
 const partial=await (await get('/api/processing?kind=raw&q=al-archive&from=2026-10-01&to=2026-10-01')).json();assert.equal(partial.pagination.total,2);
 const literal=await (await get('/api/processing?kind=raw&q=%25')).json();assert.equal(literal.pagination.total,0);
 assert.equal((await post({action:'retry'})).status,200);
 console.log('PASS: deployed archive admin endpoints, same-origin writes, settings validation, archive scope, equipment/date list filters and retries. No source or S3 requests.');
 if(process.argv.includes('--preview')){console.log('PREVIEW '+origin+' PID '+process.pid);await new Promise(()=>{});}
}catch(e){console.error(logs);throw e;}finally{await stop();}
