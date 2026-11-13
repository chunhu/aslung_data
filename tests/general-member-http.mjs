// pnpm build first. Disposable SQLite and localhost HTTP, no production data or email.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {tokenHash,hashPassword} from '../lib/passwords.mjs';
import {createFileLink} from '../lib/file-links.mjs';
import {saveMemberAccess} from '../lib/member-access.mjs';
const dir=mkdtempSync(join(tmpdir(),'aslung-basic-http-'));
process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {getConnection}=await import('../lib/store.mjs');const d=getConnection(),cookies={};
const password='Local-Role-Test-2026!',hash=await hashPassword(password);
for(const role of ['admin','basic','member']){const email=role+'@test.invalid',token=randomBytes(32).toString('hex');d.prepare('INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,?,1,?)').run(email,role,role,role,role,hash);d.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),email,Date.now()+600000);cookies[role]='aslung_session='+token;}
// An old data grant, maintainer link and API token must never bypass the basic role.
d.prepare("INSERT INTO devices(id,name) VALUES('AL-BASIC','Fixture')").run();
d.prepare("INSERT INTO grants(grant_type,device_id,email,start) VALUES('device','AL-BASIC','basic@test.invalid','2020-01-01T00:00:00Z')").run();
d.prepare("INSERT INTO maintainers(name,email,created_at) VALUES('basic','basic@test.invalid','2020-01-01')").run();
const apiToken='aslung_'+randomBytes(24).toString('hex');d.prepare('INSERT INTO api_tokens VALUES(?,?,?)').run(apiToken,'basic@test.invalid',new Date().toISOString());
const admin={role:'admin',email:'admin@test.invalid'};
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,cwd=resolve('.next/standalone');
for(const [target,source] of [['public','public'],['.next/static','.next/static']])if(!existsSync(join(cwd,target)))symlinkSync(resolve(source),join(cwd,target),'dir');
const child=spawn(process.execPath,[join(cwd,'server.js')],{cwd,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
const get=(path,role='basic',headers={})=>fetch(origin+path,{headers:{Cookie:cookies[role],...headers},redirect:'manual'});
const post=(path,body,role='basic')=>fetch(origin+path,{method:'POST',headers:{Cookie:cookies[role],Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
try{
let ready=false;for(let n=0;n<100;n++){try{if((await get('/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,logs);
for(const scope of ['bootstrap','news','articles','files','full']){const response=await get('/api/manage?scope='+scope);assert.equal(response.status,200);const body=await response.json();assert.equal(body.me.role,'basic');for(const field of ['devices','downloadSegments','members','grants','locations','tokens','labs','maintainers','alertChecks','alertLogs','grantRequests'])assert.deepEqual(body[field],[],field);assert.equal(body.isMaintainer,false);assert.equal(body.connected,false);assert.deepEqual(body.alertSettings,{});}
for(const scope of ['realtime','data','devices','maintenance','calibration','personal','hobo','members','permissions','locations','labs','maintainers','alerts','connection','activity'])assert.equal((await get('/api/manage?scope='+scope)).status,403,scope);
const denied=['/api/realtime','/api/realtime/discover','/api/data?aslung_id=AL-BASIC&start=2026-01-01T00%3A00%3A00Z&end=2026-01-02T00%3A00%3A00Z','/api/personal','/api/processing','/api/processing/cleanup','/api/hobo','/api/hobo/cleanup','/api/maintenance','/api/my-maintained-devices','/api/device-management','/api/fleet','/api/alerts','/api/calibration','/api/calibration/history','/api/member-access','/api/maintainer-links','/api/activity','/docs/ASLUNG_Website_User_Manual_ZH.html'];
for(const path of denied){assert.equal((await get(path)).status,403,path);assert.equal((await get(path,'basic',{Authorization:'Bearer '+apiToken})).status,403,path+' token');}
for(const action of ['tokenCreate','tokenDelete','requestGrant','alertEmailPreference','cronCheck','revokeBulk','memberRole'])assert.equal((await post('/api/manage',{action})).status,403,action);
for(const kind of ['news','article'])assert.equal((await get('/api/posts?kind='+kind)).status,200,kind);
assert.equal((await post('/api/posts',{action:'save'})).status,403);
const link=createFileLink(d,admin,{name:'Shared',url:'https://example.invalid/fixture',emails:['basic@test.invalid']}).fileId;
let files=await (await get('/api/files')).json();assert.equal(files.files.length,1);assert.equal(files.files[0].id,link);assert.equal(files.files[0].permissions.download,true);
const hidden=createFileLink(d,admin,{name:'Private',url:'https://example.invalid/private',emails:[]}).fileId;assert.equal((await get('/api/files?id='+hidden+'&download=1')).status,403);
assert.equal((await get('/api/files?id='+link+'&download=1')).status,303);
assert.equal((await get('/api/manage?scope=realtime','member')).status,200);
// Downgrade preserves grants but blocks the same existing login session immediately.
saveMemberAccess(d,admin,{email:'member@test.invalid',role:'basic',device_ids:[]});assert.equal((await get('/api/realtime','member')).status,403);
const create=await post('/api/manage',{action:'member',name:'New general',nickname:'new_general',email:'newgeneral@test.invalid',password,role:'basic'},'admin');assert.equal(create.status,200,await create.text());assert.equal(d.prepare("SELECT role FROM members WHERE email='newgeneral@test.invalid'").get().role,'basic');
const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'basic@test.invalid',password})});assert.equal(login.status,200);
console.log('PASS: general-member creation/login, limited metadata, resource access, private files, 20 restricted endpoints, old tokens and grants, blocked actions, and immediate role downgrade.');
if(process.argv.includes('--preview')){console.log('PREVIEW '+origin+' login basic@test.invalid / '+password);await new Promise(resolve=>process.once('SIGTERM',resolve));}
}finally{child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));d.close();rmSync(dir,{recursive:true,force:true});}
