import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as guest from '../lib/guest-files.mjs';
import * as security from '../lib/http-security.mjs';
import * as links from '../lib/file-links.mjs';
import * as registration from '../lib/registration.mjs';
function fixture(){
 const d=new DatabaseSync(':memory:');d.exec(`CREATE TABLE members(email TEXT PRIMARY KEY,role TEXT,active INTEGER);INSERT INTO members VALUES('admin@test','admin',1);
 CREATE TABLE files(id TEXT PRIMARY KEY,name TEXT,description TEXT,size INTEGER,mime_type TEXT,storage_path TEXT,external_url TEXT,download_count INTEGER DEFAULT 0,created_at TEXT);
 INSERT INTO files VALUES('f','Data.csv','Public description',5,'text/csv','/private/secret',NULL,0,'2026-01-01'),('url','External','',0,'text/plain','','https://example.test/private',0,'2026-01-01');`);
 let role='admin',mailFailure=false,fileMissing=false;const messages=[],closed=[],origin='http://test';
 class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
 const deps={'@/lib/store.mjs':{getConnection:()=>d},'@/lib/guest-files.mjs':guest,'@/lib/http-security.mjs':security,'@/lib/file-links.mjs':links,'@/lib/registration.mjs':registration,
 '@/lib/activity.mjs':{clientIp:()=>''},'@/lib/activity-server':{setActivityAction:()=>{},auditOperation:async(r,h)=>h()},
 '@/lib/server':{identity:async()=>{if(role==='guest')throw new AppError(401,'Sign in');return {email:'admin@test',role};},writeGuard:r=>{if(r.headers.get('origin')!==origin)throw new AppError(403,'origin');},AppError,fail:e=>Response.json({error:e.message},{status:e.status||500})},
 '@/lib/registration-mail':{registrationMailer:()=>({guestCode:async(email,code)=>{if(mailFailure)throw new Error('SMTP failed');messages.push({email,code});},guestShare:async(share)=>{if(mailFailure)throw new Error('SMTP failed');messages.push(share);}})},
 'node:fs/promises':{default:{open:async()=>{if(fileMissing)throw new Error('missing');return {stat:async()=>({size:5,isFile:()=>true}),close:async()=>{closed.push(true);},readableWebStream:()=>new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('a,b\n1'));c.close();}})};}}}};
 const code=ts.transpileModule(readFileSync(new URL('../app/api/guest-files/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const m={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);
 return {d,messages,closed,role:r=>{role=r;},mailFailure:v=>{mailFailure=v;},fileMissing:v=>{fileMissing=v;},
 post:(p,requestOrigin=origin)=>m.exports.POST(new Request(origin+'/api/guest-files',{method:'POST',headers:{origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(p)})),
 get:(params={})=>m.exports.GET(new Request(origin+'/api/guest-files?'+new URLSearchParams(params)))};
}
const input={file_id:'f',email:'guest@example.test',name:'Name',organization:'Institute',purpose:'Research',expires_at:new Date(Date.now()+86400000).toISOString(),max_downloads:2};
test('public application → OTP verification → admin approval → emailed link → separate OTP → tracked download needs no member',async()=>{
 const f=fixture();try{
  assert.equal((await f.post({action:'publication',file_id:'f',enabled:true})).status,200);
  f.role('guest');const catalog=await (await f.get()).json();assert.equal(catalog.total,1);assert.ok(!JSON.stringify(catalog).includes('private'));
  const result=await (await f.post({action:'request',...input})).json();assert.ok(result.id);assert.equal(result.code,undefined);
  assert.equal((await f.get({action:'admin'})).status,401);
  assert.equal((await f.post({action:'verifyRequest',id:result.id,code:f.messages.at(-1).code})).status,200);
  assert.equal((await f.post({action:'review',id:result.id,decision:'approve',...input})).status,401);
  f.role('admin');const approval=await (await f.post({action:'review',id:result.id,decision:'approve',...input})).json();assert.equal(approval.mail_status,'sent');assert.equal(approval.token,undefined);
  const token=f.messages.at(-1).token;f.role('guest');
  assert.equal((await f.post({action:'code',token})).status,200);const v=await (await f.post({action:'verifyDownload',token,code:f.messages.at(-1).code})).json();assert.ok(v.session);
  const response=await f.post({action:'download',session:v.session});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(await response.text(),'a,b\n1');
  assert.equal(f.d.prepare('SELECT status FROM guest_file_downloads').get().status,'completed');assert.equal(f.closed.length,1);
  f.role('admin');const report=await (await f.get({action:'admin'})).json();assert.equal(report.downloads.total,1);assert.ok(!JSON.stringify(report).includes(token));
  const csv=await f.get({action:'export'});assert.equal(csv.status,200);assert.match(await csv.text(),/guest@example.test/);
  assert.equal(f.d.prepare('SELECT COUNT(*) n FROM members').get().n,1);
 }finally{f.d.close();}
});
test('direct shares, mail failure retry, disabled links, private metadata and origin guards',async()=>{
 const f=fixture();try{
  f.role('basic');assert.equal((await f.post({action:'create',...input})).status,403);f.role('admin');
  assert.equal((await f.post({action:'create',...input},'http://evil')).status,403);
  f.mailFailure(true);const result=await (await f.post({action:'create',...input})).json();assert.equal(result.mail_status,'failed');
  f.mailFailure(false);assert.equal((await f.post({action:'resend',id:result.id})).status,200);const token=f.messages.at(-1).token;
  assert.equal((await f.post({action:'disable',id:result.id})).status,200);f.role('guest');assert.equal((await f.post({action:'code',token})).status,403);
  assert.equal((await f.get()).status,200);assert.equal((await (await f.get()).json()).total,0);
 }finally{f.d.close();}
});
test('missing local file does not consume quota; cancellation and external redirects have distinct logs',async()=>{
 const f=fixture();try{
  const create=async(file_id='f')=>{await f.post({action:'create',...input,file_id});const token=f.messages.at(-1).token;await f.post({action:'code',token});return (await (await f.post({action:'verifyDownload',token,code:f.messages.at(-1).code})).json()).session;};
  const session=await create();f.fileMissing(true);assert.equal((await f.post({action:'download',session})).status,404);assert.equal(f.d.prepare('SELECT used_downloads FROM guest_file_shares').get().used_downloads,0);
  f.fileMissing(false);const response=await f.post({action:'download',session});await response.body.cancel();assert.equal(f.d.prepare('SELECT status FROM guest_file_downloads').get().status,'interrupted');
  const external=await create('url');const result=await (await f.post({action:'download',session:external})).json();assert.equal(result.external_url,'https://example.test/private');
  assert.equal(f.d.prepare("SELECT status FROM guest_file_downloads WHERE file_id='url'").get().status,'redirected');
 }finally{f.d.close();}
});
