// pnpm build first. Isolated SQLite and disposable upload files; no production services.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {tokenHash} from '../lib/passwords.mjs';
const dir=mkdtempSync(join(tmpdir(),'aslung-files-http-'));
process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {getConnection}=await import('../lib/store.mjs');const d=getConnection(),cookies={},uploads=[];
for(const role of ['admin','manager','reader','stranger']){const email=role+'@test.invalid',token=randomBytes(32).toString('hex');d.prepare('INSERT INTO members(email,user_id,name,role,active,password_hash) VALUES(?,?,?,?,1,?)').run(email,role,role,role==='admin'?'admin':'member','unused');d.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),email,Date.now()+120000);cookies[role]='aslung_session='+token;}
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,cwd=resolve('.next/standalone');
const child=spawn(process.execPath,[join(cwd,'server.js')],{cwd,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
const get=(path,role='admin')=>fetch(origin+path,{headers:{Cookie:cookies[role]},redirect:'manual'});
const post=(body,role='admin',endpoint='/api/files')=>fetch(origin+endpoint,{method:'POST',headers:{Cookie:cookies[role],Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
async function ok(response){const r=await response,body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;}
const rights=(extra={})=>({view:true,download:false,manage:false,grant:false,...extra});
let folder;
const grant=(subject,extra={},role='admin')=>post({action:'permissionSave',resource_type:'folder',resource_id:folder,subject_type:'user',subject_id:subject+'@test.invalid',permissions:rights(),...extra},role);
try{
let ready=false;for(let n=0;n<100;n++){try{if((await get('/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,logs);
assert.equal((await fetch(origin+'/api/files')).status,401);
folder=(await ok(post({action:'folderSave',name:'HTTP isolated folder'}))).id;
const group=(await ok(post({action:'groupSave',name:'HTTP readers',emails:['reader@test.invalid']}))).id;
await ok(grant('reader',{subject_type:'group',subject_id:group}));
await ok(grant('manager',{permissions:rights({manage:true})}));
const upload=async(role,folderId,mime='text/plain')=>{const form=new FormData();form.set('file',new Blob(['confidential fixture'],{type:mime}),'fixture.txt');return fetch(origin+'/api/files?folder='+folderId,{method:'POST',headers:{Cookie:cookies[role],Origin:origin},body:form});};
assert.equal((await upload('reader',folder)).status,403);
assert.equal((await upload('manager','root')).status,403);
const fileId=(await ok(upload('manager',folder))).fileId;uploads.push(d.prepare('SELECT storage_path FROM files WHERE id=?').get(fileId).storage_path);
const listed=await ok(get('/api/files?folder='+folder,'reader'));assert.equal(listed.files.length,1);assert.equal(listed.files[0].permissions.download,false);assert.equal('storage_path' in listed.files[0],false);
assert.equal((await get('/api/files?folder='+folder,'stranger')).status,404);
let preview=await get('/api/files?id='+fileId,'reader');assert.equal(preview.status,200);assert.match(preview.headers.get('content-disposition'),/^inline/);assert.match(preview.headers.get('content-security-policy'),/sandbox/);assert.equal(await preview.text(),'confidential fixture');
for(const role of ['reader','manager','stranger'])assert.equal((await get('/api/files?id='+fileId+'&download=1',role)).status,403);
assert.equal((await grant('stranger',{},'manager')).status,403);
await ok(post({action:'fileUpdate',id:fileId,name:'Renamed fixture',description:'Updated'},'manager'));
assert.equal((await post({action:'fileGrantsUpdate',fileId,emails:['reader@test.invalid']},'manager','/api/manage')).status,403);
const expires=new Date(Date.now()+60000).toISOString();
const source=(await ok(grant('manager',{permissions:rights({download:true,grant:true}),valid_until:expires}))).id;
assert.equal((await grant('stranger',{},'manager')).status,403);
const delegated=(await ok(grant('stranger',{permissions:rights({download:true}),valid_until:expires},'manager'))).id;
const download=await get('/api/files?id='+fileId+'&download=1','stranger');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);await download.text();
await ok(post({action:'permissionDelete',id:source}));assert.equal((await get('/api/files?id='+fileId+'&download=1','stranger')).status,403);assert.equal(d.prepare('SELECT 1 FROM file_permissions WHERE id=?').get(delegated),undefined);
await ok(post({action:'groupSave',id:group,revision:1,name:'HTTP readers',emails:[]}));assert.equal((await get('/api/files?id='+fileId,'reader')).status,403);
const legacy=await ok(get('/api/manage?scope=files','reader'));assert.equal(legacy.files.length,0);
const pending=await ok(grant('reader',{valid_from:new Date(Date.now()+60000).toISOString()}));assert.equal((await get('/api/files?id='+fileId,'reader')).status,403);
d.prepare('UPDATE file_permissions SET valid_from=?,valid_until=? WHERE id=?').run('2020-01-01T00:00:00Z',new Date(Date.now()-1).toISOString(),pending.id);assert.equal((await get('/api/files?id='+fileId,'reader')).status,403);
const link=(await ok(post({action:'fileLink',folder_id:folder,name:'Private URL',url:'https://example.invalid/secret?token=abc',emails:[]}))).fileId;
await ok(grant('reader'));assert.equal((await get('/api/files?id='+link,'reader')).status,403);assert.equal((await get('/api/files?id='+link+'&download=1','reader')).status,403);
await ok(grant('reader',{permissions:rights({download:true})}));const redirect=await get('/api/files?id='+link+'&download=1','reader');assert.equal(redirect.status,303);
assert.equal((await post({action:'folderDelete',id:folder})).status,409);
console.log('PASS: folders, group membership, delegated upload, separate view/download/manage/grant, scope isolation, safe preview, private metadata, expiry, parent revocation, legacy API enforcement and external-link protection.');
}finally{child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));for(const file of uploads)rmSync(file,{force:true});d.close();rmSync(dir,{recursive:true,force:true});}
