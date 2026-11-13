import * as activityAuditMock from './helpers/activity-audit.mjs';
import * as activityHttpSecurity from '../lib/http-security.mjs';
import * as activityNodeStream from 'node:stream';
import {randomBytes} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as reset from '../lib/password-reset.mjs';
import * as passwords from '../lib/passwords.mjs';
import * as registration from '../lib/registration.mjs';

function fixture(){
  const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE members(email TEXT PRIMARY KEY,user_id TEXT,name TEXT,nickname TEXT,active INTEGER,password_hash TEXT);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT REFERENCES members(email) ON DELETE CASCADE,expires_at INTEGER);
    CREATE TABLE login_attempts(email TEXT PRIMARY KEY,window_start INTEGER,failures INTEGER);`);
  d.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run('member@example.test','user-1','Member','member',1,'original-hash');
  d.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run('disabled@example.test','user-2','Disabled','disabled',0,'disabled-hash');
  d.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run('dev@local.aslung','user-3','Local','local',1,'local-hash');
  reset.ensurePasswordResetSchema(d);registration.initializeRegistrationSchema(d);return d;
}
function load(path,deps){
  const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);return module.exports;
}
const password='New-Password-2026!';
const confirmation=token=>({token,password,confirm_password:password});
test('reset issuance hashes random tokens, hides ineligible accounts and replaces prior links',()=>{
  const d=fixture();try{
    assert.equal(reset.resetEmail(' Member@Example.Test '),'member@example.test');
    for(const value of [null,'bad','x\n@example.test','x'.repeat(255)])assert.throws(()=>reset.resetEmail(value));
    for(const email of ['unknown@example.test','disabled@example.test','dev@local.aslung'])assert.equal(reset.issuePasswordReset(d,email),null);
    const first=reset.issuePasswordReset(d,'member@example.test','en',1000),second=reset.issuePasswordReset(d,'member@example.test','en',2000);
    assert.match(first.token,/^[a-f0-9]{64}$/);assert.notEqual(first.token,second.token);
    const rows=d.prepare('SELECT * FROM password_resets').all();assert.equal(rows.length,1);assert.equal(rows[0].token_hash,passwords.tokenHash(second.token));
    assert.ok(!JSON.stringify(rows).includes(second.token));assert.equal(rows[0].expires_at,2000+reset.PASSWORD_RESET_TTL_MS);
  }finally{d.close();}
});
test('a valid reset changes the password, revokes every session and login lockout, and is one-use only',async()=>{
  const d=fixture();try{
    d.exec("INSERT INTO sessions VALUES('one','member@example.test',9999999),('two','member@example.test',9999999),('other','disabled@example.test',9999999); INSERT INTO login_attempts VALUES('member',0,5),('member@example.test',0,5);");
    const {token}=reset.issuePasswordReset(d,'member@example.test');
    await assert.rejects(reset.completePasswordReset(d,{...confirmation(token),confirm_password:'wrong'}));
    await assert.rejects(reset.completePasswordReset(d,{...confirmation(token),password:'short',confirm_password:'short'}));
    await reset.completePasswordReset(d,confirmation(token));
    assert.equal(await passwords.verifyPassword(password,d.prepare('SELECT password_hash FROM members WHERE user_id=?').get('user-1').password_hash),true);
    assert.equal(d.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);assert.equal(d.prepare('SELECT COUNT(*) n FROM login_attempts').get().n,0);
    assert.equal(d.prepare('SELECT active FROM members WHERE user_id=?').get('user-1').active,1);
    await assert.rejects(reset.completePasswordReset(d,confirmation(token)),error=>error.status===400);
  }finally{d.close();}
});
test('expired, superseded, disabled and changed-credential links cannot reset a password',async()=>{
  for(const change of ['expired','superseded','disabled','password','email','identity']){
    const d=fixture();try{
      const {token}=reset.issuePasswordReset(d,'member@example.test','en',1000);
      if(change==='superseded')reset.issuePasswordReset(d,'member@example.test','en',2000);
      if(change==='disabled')d.exec("UPDATE members SET active=0 WHERE user_id='user-1'");
      if(change==='password')d.exec("UPDATE members SET password_hash='admin-changed' WHERE user_id='user-1'");
      if(change==='email')d.exec("UPDATE members SET email='changed@example.test' WHERE user_id='user-1'");
      if(change==='identity')d.exec("UPDATE members SET user_id='replacement' WHERE email='member@example.test'");
      await assert.rejects(reset.completePasswordReset(d,confirmation(token),{now:()=>change==='expired'?1000+reset.PASSWORD_RESET_TTL_MS:3000,hash:async()=>assert.fail('invalid token must not hash a password')}),error=>error.status===400);
    }finally{d.close();}
  }
});
test('simultaneous resets, expiry during hashing and revocation during hashing are checked atomically',async()=>{
  const d=fixture();try{
    let clock=1000;let {token}=reset.issuePasswordReset(d,'member@example.test','en',clock);
    await assert.rejects(reset.completePasswordReset(d,confirmation(token),{now:()=>clock,hash:async()=>{clock+=reset.PASSWORD_RESET_TTL_MS;return 'hash';}}));
    ({token}=reset.issuePasswordReset(d,'member@example.test'));
    await assert.rejects(reset.completePasswordReset(d,confirmation(token),{hash:async()=>{d.exec("UPDATE members SET active=0 WHERE user_id='user-1'");return 'hash';}}));
    d.exec("UPDATE members SET active=1 WHERE user_id='user-1'");({token}=reset.issuePasswordReset(d,'member@example.test'));
    const results=await Promise.allSettled([reset.completePasswordReset(d,confirmation(token)),reset.completePasswordReset(d,confirmation(token))]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
  }finally{d.close();}
});
test('API checks origin, limits input and rate, uses generic responses and defers email delivery',async()=>{
  const d=fixture(),queued=[],sent=[];
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const route=load('../app/api/auth/password-reset/route.ts',{
    'next/server':{after:callback=>queued.push(callback)},'@/lib/store.mjs':{getConnection:()=>d},'@/lib/password-reset.mjs':reset,
    '@/lib/registration.mjs':registration,'@/lib/passwords.mjs':passwords,
    '@/lib/registration-mail':{registrationMailer:()=>({resetPassword:async mail=>sent.push(mail)})},
    '@/lib/activity-server':activityAuditMock,'@/lib/http-security.mjs':activityHttpSecurity,'node:stream':activityNodeStream,'@/lib/server':{AppError,writeGuard:request=>{if(request.headers.get('origin')!=='http://test')throw new AppError(403,'origin');},fail:error=>Response.json({error:error.message},{status:error.status||500})},
  });
  const request=(payload,origin='http://test')=>new Request('http://test/api/auth/password-reset',{method:'POST',headers:{Origin:origin},body:JSON.stringify(payload)});
  try{
    assert.equal((await route.POST(request({action:'request',email:'member@example.test'},'http://other'))).status,403);
    assert.equal((await route.POST(request({action:'request',email:'x'.repeat(5000)}))).status,413);
    const responses=[];
    for(const email of ['member@example.test','unknown@example.test','disabled@example.test']){
      const response=await route.POST(request({action:'request',email}));assert.equal(response.headers.get('cache-control'),'no-store');responses.push(await response.text());
    }
    assert.equal(new Set(responses).size,1);assert.equal(sent.length,0);
    for(const callback of queued)await callback();assert.equal(sent.length,1);assert.equal(sent[0].email,'member@example.test');
    for(let n=0;n<2;n++)assert.equal((await route.POST(request({action:'request',email:'unknown@example.test'}))).status,200);
    assert.equal((await route.POST(request({action:'request',email:'unknown@example.test'}))).status,429);
    assert.equal((await route.POST(request({action:'reset',...confirmation(sent[0].token)}))).status,200);
    assert.equal((await route.POST(request({action:'reset',...confirmation(sent[0].token)}))).status,400);
  }finally{d.close();}
});
test('SMTP mail contains a fragment-only single-use link on the configured site',async()=>{
  const messages=[],d=fixture(),previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://hub.example.test';
  d.exec("CREATE TABLE alert_settings(id INTEGER,smtp_host TEXT,smtp_port INTEGER,smtp_user TEXT,smtp_pass TEXT,smtp_from TEXT); INSERT INTO alert_settings VALUES(1,'smtp.example.test',587,'','','hub@example.test');");
  const {registrationMailer}=load('../lib/registration-mail.ts',{'nodemailer':{default:{createTransport:()=>({sendMail:async message=>messages.push(message)})}},'./store.mjs':{getConnection:()=>d},'./registration.mjs':registration});
  try{
    await registrationMailer().resetPassword({email:'member@example.test',language:'en',token:'a'.repeat(64)});
    const link=new URL(messages[0].text.match(/https:\/\/[^\s]+/)[0]);assert.equal(link.origin,process.env.APP_ORIGIN);assert.equal(link.pathname,'/reset-password');
    assert.equal(link.searchParams.has('token'),false);assert.equal(new URLSearchParams(link.hash.slice(1)).get('token'),'a'.repeat(64));assert.equal(link.searchParams.get('lang'),'en');
    assert.match(messages[0].text,/30/);assert.equal(messages[0].to,'member@example.test');
  }finally{if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;d.close();}
});

test('a login using the old password cannot create a session after a reset finishes during verification',async()=>{
  const d=fixture();class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const {token}=reset.issuePasswordReset(d,'member@example.test');
  const login=load('../app/api/auth/login/route.ts',{
    'next/server':{NextResponse:Response},'node:crypto':{randomBytes},'@/lib/store.mjs':{getConnection:()=>d},
    '@/lib/passwords.mjs':{...passwords,hashPassword:async()=> 'dummy',verifyPassword:async()=>{await reset.completePasswordReset(d,confirmation(token),{hash:async()=> 'replacement-hash'});return true;}},
    '@/lib/auth':{sessionCookie:()=>assert.fail('must not issue a cookie')},
    '@/lib/activity-server':activityAuditMock,'@/lib/http-security.mjs':activityHttpSecurity,'node:stream':activityNodeStream,'@/lib/server':{AppError,writeGuard:()=>{},fail:error=>Response.json({error:error.message},{status:error.status||500})},
  });
  try{const response=await login.POST(new Request('http://test/api/auth/login',{method:'POST',body:JSON.stringify({email:'member@example.test',password:'Old-Password-2026!'})}));assert.equal(response.status,401);assert.equal(d.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);}
  finally{d.close();}
});
