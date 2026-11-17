// Build first. Disposable K: SQLite; no worker, source MySQL or real S3 requests.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {tokenHash} from '../lib/passwords.mjs';
import {advanceHistoricalBatch} from '../lib/historical-batches.mjs';
const base=resolve('K:/CodexCache/aslung_data/monthly-http-tests');mkdirSync(base,{recursive:true});const dir=mkdtempSync(join(base,'batch-'));
process.env.DATABASE_PATH=join(dir,'test.sqlite');const {getConnection}=await import('../lib/store.mjs');const d=getConnection(),cookies={};
for(const role of ['admin','member']){const token=randomBytes(32).toString('hex');d.prepare('INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,?,1,?)').run(role+'@test.invalid',role,role,role,role,'unused');d.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),role+'@test.invalid',Date.now()+3600000);cookies[role]='aslung_session='+token;}
const device='AL-MONTHLY-TEST';d.prepare('INSERT INTO devices(id,name) VALUES(?,?)').run(device,'Monthly archive fixture');
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin=`http://127.0.0.1:${port}`,cwd=resolve('.next/standalone');
for(const [target,source] of [['public','public'],['.next/static','.next/static']])if(!existsSync(join(cwd,target)))symlinkSync(resolve(source),join(cwd,target),'dir');
const configuration={mode:'s3',bucket:'aslung-test-bucket',region:'ap-northeast-1'};
const child=spawn(process.execPath,[join(cwd,'server.js')],{cwd,windowsHide:true,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin,CALIBRATION_STORAGE:'s3',S3_BUCKET:configuration.bucket,AWS_REGION:configuration.region},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
const get=(role='admin')=>fetch(origin+'/api/processing',{headers:{Cookie:cookies[role]}});
const post=(p,role='admin',source=origin)=>fetch(origin+'/api/processing',{method:'POST',headers:{Origin:source,Cookie:cookies[role],'Content-Type':'application/json'},body:JSON.stringify(p)});
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,logs);
 const p={action:'historical',devices:[device],kind:'both',from:'2025-01-01',to:'2025-12-31',requestKey:randomUUID()};
 assert.equal((await get('member')).status,403);assert.equal((await post(p,'member')).status,403);assert.equal((await post(p,'admin','https://foreign.invalid')).status,403);
 let response=await post(p);assert.equal(response.status,200,await response.clone().text());const batch=await response.json();assert.equal(batch.months,12);assert.equal(batch.total,730);assert.equal((await (await post(p)).json()).id,batch.id);
 assert.equal(d.prepare('SELECT count(*) n FROM processing_jobs').get().n,0);assert.equal((await (await get()).json()).historical[0].id,batch.id);
 const control=operation=>post({action:'historicalControl',id:batch.id,operation});assert.equal((await control('pause')).status,200);assert.equal(advanceHistoricalBatch(d,{configuration,window:2}),null);
 assert.equal((await control('resume')).status,200);advanceHistoricalBatch(d,{configuration,window:2});
 const status=(await (await get()).json()).historical[0];assert.equal(status.current.label,'2025-01');assert.equal(status.current.generated,2);assert.equal(status.current.skipped,1);assert.equal(status.current.queued,1);assert.ok(status.months.slice(1).every(m=>m.generated===0));
 assert.equal((await control('cancel')).status,200);assert.equal((await (await get()).json()).historical[0].status,'CANCELLED');assert.equal(d.prepare('SELECT status FROM processing_jobs').get().status,'CANCELLED');assert.equal((await control('resume')).status,409);
 console.log('PASS: deployed monthly batch API, authorization, request replay, progress, pause/resume/cancel and bounded first-month planning; no source or S3 requests.');
}catch(e){console.error(logs);throw e;}finally{child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));d.close();if(!resolve(dir).startsWith(base+sep))throw new Error('Unsafe cleanup');rmSync(dir,{recursive:true,force:true});}
