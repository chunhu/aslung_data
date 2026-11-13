// Run after pnpm build. Isolated SQLite and local HTTP; no real email is sent.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {hashPassword,tokenHash} from '../lib/passwords.mjs';
import {issuePasswordReset} from '../lib/password-reset.mjs';
const dir=mkdtempSync(join(tmpdir(),'aslung-reset-http-')),root=resolve('.');
process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {getConnection}=await import('../lib/store.mjs');const d=getConnection();
const oldPassword='Original-Password-2026!',newPassword='Replacement-Password-2026!';
const oldHash=await hashPassword(oldPassword);
for(const [email,active] of [['member@example.test',1],['disabled@example.test',0]])d.prepare('INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,?,?,?)').run(email,email,'Test',email.split('@')[0],'member',active,oldHash);
d.prepare('INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,?,?,?)').run('admin@example.test','admin-user','Admin','admin','admin',1,oldHash);
const adminSession=randomBytes(32).toString('hex');d.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(adminSession),'admin@example.test',Date.now()+60000);
const session=randomBytes(32).toString('hex');d.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(session),'member@example.test',Date.now()+60000);
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const origin=`http://127.0.0.1:${port}`,cwd=join(root,'.next/standalone');
const child=spawn(process.execPath,[join(cwd,'server.js')],{cwd,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
const post=(body,requestOrigin=origin)=>fetch(origin+'/api/auth/password-reset',{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)});
try{
  let ready=false;
  for(let n=0;n<100;n++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await delay(100);}
  assert.ok(ready,'Server not ready: '+logs);
  for(const page of ['/login','/forgot-password?lang=zh-TW','/forgot-password?lang=en','/reset-password'])assert.equal((await fetch(origin+page)).status,200,page);
  assert.equal((await post({action:'request',email:'member@example.test'},'https://other.test')).status,403);
  // Missing SMTP is a site-wide error, independent of account existence.
  const missing=await post({action:'request',email:'missing@example.test'}),known=await post({action:'request',email:'member@example.test'});
  assert.equal(missing.status,503);assert.equal(known.status,503);assert.deepEqual(await missing.json(),await known.json());
  const adminHeaders={Cookie:'aslung_session='+adminSession,Origin:origin,'Content-Type':'application/json'};
  const memberHeaders={Cookie:'aslung_session='+session,Origin:origin,'Content-Type':'application/json'};
  assert.equal((await fetch(origin+'/api/activity')).status,401);
  assert.equal((await fetch(origin+'/api/activity',{headers:memberHeaders})).status,403);
  assert.equal((await fetch(origin+'/api/activity',{headers:adminHeaders})).status,200);
  const visit=await fetch(origin+'/api/activity/visit',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({path:'/login'})});
  assert.equal(visit.status,200);const visitorCookie=visit.headers.get('set-cookie').split(';')[0],visitStats=await visit.json();
  const repeated=await fetch(origin+'/api/activity/visit',{method:'POST',headers:{Origin:origin,Cookie:visitorCookie,'Content-Type':'application/json'},body:JSON.stringify({path:'/login'})});assert.equal((await repeated.json()).totalVisits,visitStats.totalVisits);
  assert.equal((await fetch(origin+'/api/activity/visit',{method:'POST',headers:{Origin:'https://other.test'},body:JSON.stringify({path:'/login'})})).status,403);
  const sendManage=(body,headers=adminHeaders)=>fetch(origin+'/api/manage',{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await sendManage({action:'cronCheck'},memberHeaders)).status,403);
  for(const action of ['locationSyncGoogle','labSyncGoogle','maintainerSyncGoogle']){
    const response=await sendManage({action,url:'http://169.254.169.254/latest/meta-data/'});assert.equal(response.status,400,action);
  }
  d.prepare("UPDATE alert_settings SET smtp_pass='do-not-expose-this-value' WHERE id=1").run();
  const adminState=await (await fetch(origin+'/api/manage?scope=news',{headers:adminHeaders})).json();assert.equal(adminState.alertSettings.smtp_pass,'');
  assert.equal((await sendManage({action:'tokenCreate'})).status,200);
  const apiKey=d.prepare('SELECT id FROM api_tokens WHERE email=?').get('admin@example.test').id;
  assert.equal((await sendManage({action:'tokenDelete',id:apiKey})).status,200);
  const form=new FormData();form.set('file',new Blob(['<script>document.body.textContent="unsafe"</script>'],{type:'text/html'}),'security-fixture.html');
  const upload=await fetch(origin+'/api/files',{method:'POST',headers:{Cookie:adminHeaders.Cookie,Origin:origin},body:form});assert.equal(upload.status,200);
  const fileId=(await upload.json()).fileId,storedFile=d.prepare('SELECT storage_path FROM files WHERE id=?').get(fileId);
  try{
    const response=await fetch(origin+'/api/files?id='+fileId,{headers:adminHeaders});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment/);assert.match(response.headers.get('content-security-policy'),/sandbox/);assert.equal(response.headers.get('content-type'),'application/octet-stream');await response.text();
    assert.equal((await fetch(origin+'/api/files?id='+fileId,{headers:memberHeaders})).status,403);
  }finally{rmSync(storedFile.storage_path,{force:true});}
  const audit=await fetch(origin+'/api/activity',{headers:adminHeaders});assert.match(audit.headers.get('cache-control'),/no-store/);const auditText=await audit.text();
  assert.ok(!auditText.includes(apiKey));assert.ok(!auditText.includes('do-not-expose-this-value'));
  const events=JSON.parse(auditText).rows;assert.ok(events.some(row=>row.kind==='operation'&&row.outcome==='failure'));assert.ok(events.some(row=>row.kind==='download'));assert.ok(events.some(row=>row.kind==='visit'));
  const before=await fetch(origin+'/api/manage?scope=news',{headers:{Cookie:'aslung_session='+session}});assert.equal(before.status,200);
  const {token}=issuePasswordReset(d,'member@example.test');
  const response=await post({action:'reset',token,password:newPassword,confirm_password:newPassword});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(origin+'/api/manage?scope=news',{headers:{Cookie:'aslung_session='+session}})).status,401);
  assert.equal((await post({action:'reset',token,password:newPassword,confirm_password:newPassword})).status,400);
  const login=password=>fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'member@example.test',password})});
  assert.equal((await login(oldPassword)).status,401);
  const signedIn=await login(newPassword);assert.equal(signedIn.status,200);assert.match(signedIn.headers.get('set-cookie'),/aslung_session=/);
  assert.equal(d.prepare('SELECT active FROM members WHERE email=?').get('disabled@example.test').active,0);
  console.log('PASS: production admin-only logs, visit deduplication, SSRF blocking, safe file downloads, secret redaction, password reset pages, CSRF, SMTP availability, one-use tokens, old sessions revoked, old password rejected and new password login. No real email sent.');
}finally{
  child.kill('SIGTERM');if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));
  d.close();rmSync(dir,{recursive:true,force:true});
}
