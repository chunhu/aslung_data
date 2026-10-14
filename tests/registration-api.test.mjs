import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import crypto from 'node:crypto';
import ts from 'typescript';
import * as registration from '../lib/registration.mjs';
import * as passwords from '../lib/passwords.mjs';
import * as realtime from '../lib/realtime-settings.mjs';
import * as segments from '../lib/download-segments.mjs';

function load(path,dependencies) {
  const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>{
    assert.ok(name in dependencies,'Unexpected dependency: '+name);return dependencies[name];
  },module,module.exports);return module.exports;
}
test('registration and admin API enforce origin, review permissions, activation gates and profile ownership',async()=>{
  const d=new DatabaseSync(':memory:');
  d.exec(`CREATE TABLE members(email TEXT PRIMARY KEY,user_id TEXT UNIQUE,name TEXT,nickname TEXT UNIQUE,role TEXT,active INTEGER,password_hash TEXT);
    CREATE TABLE grants(email TEXT);CREATE TABLE maintainers(name TEXT,email TEXT);CREATE TABLE device_locations(id INTEGER);CREATE TABLE devices(id TEXT);`);
  registration.initializeRegistrationSchema(d);
  const store={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async all(){return {results:d.prepare(sql).all(...args)};},async first(){return d.prepare(sql).get(...args);},async run(){return d.prepare(sql).run(...args);}};}};
  const server=load('../lib/server.ts',{'node:crypto':{default:crypto},'./store.mjs':{getStore:()=>store},'./auth':{},'./download-segments.mjs':segments});
  let actor={email:'admin@example.test',role:'admin'},capturedMail;
  const mailer={verify:async mail=>{capturedMail=mail;},review:async()=>{throw new Error('Isolated test: SMTP unavailable');}};
  const commonServer={...server,identity:async()=>actor};
  const register=load('../app/api/auth/register/route.ts',{
    '@/lib/store.mjs':{getConnection:()=>d},'@/lib/registration.mjs':registration,'@/lib/registration-mail':{registrationMailer:()=>mailer},'@/lib/server':commonServer
  });
  const manage=load('../app/api/manage/route.ts',{
    'node:crypto':{...crypto,default:crypto},'@/lib/store.mjs':{getConnection:()=>d},'@/lib/registration.mjs':registration,
    '@/lib/registration-mail':{registrationMailer:()=>mailer},'@/lib/server':commonServer,'@/lib/realtime-settings.mjs':realtime,'@/lib/passwords.mjs':passwords
  });
  const oldOrigin=process.env.APP_ORIGIN;process.env.APP_ORIGIN='http://localhost:3001';
  const request=(payload,origin=process.env.APP_ORIGIN)=>new Request('http://localhost:3001/api',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const input={name:'API applicant',nickname:'api-applicant',email:'applicant@example.test',password:'API-Applicant-2026',confirm_password:'API-Applicant-2026',country:'CA',institution:'Test institute',project_name:'International project',project_summary:'Study air quality.',role:'admin',active:1};
  try {
    assert.equal((await register.POST(request(input,'http://untrusted.test'))).status,403);
    assert.equal((await register.POST(request(input))).status,200);
    assert.equal(d.prepare('SELECT active FROM members').get().active,0);
    assert.equal(d.prepare('SELECT role FROM members').get().role,'member');
    const review={action:'memberReview',email:input.email,decision:'approve'};
    assert.equal((await manage.POST(request(review))).status,400);
    assert.equal((await manage.POST(request({action:'memberStatus',email:input.email,active:true}))).status,400);
    assert.equal((await manage.POST(request({action:'memberRole',email:input.email,role:'admin'}))).status,400);
    assert.equal((await register.POST(request({action:'verify',token:capturedMail.token}))).status,200);
    actor={email:input.email,role:'member'};
    assert.equal((await manage.POST(request(review))).status,403);
    actor={email:'admin@example.test',role:'admin'};
    const approved=await manage.POST(request(review));assert.equal(approved.status,200);assert.ok((await approved.json()).notice);
    assert.equal(d.prepare('SELECT active FROM members').get().active,1);
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM grants').get().n,0);
    actor={email:input.email,role:'member'};
    const update=await manage.POST(request({...input,action:'profileUpdate',email:'other@example.test',country:'US',registration_status:'approved'}));
    assert.equal(update.status,200);assert.equal(d.prepare('SELECT country FROM member_profiles WHERE email=?').get(input.email).country,'US');
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM member_profiles WHERE email=?').get('other@example.test').n,0);
    assert.equal(d.prepare('SELECT role FROM members').get().role,'member');
  }finally{if(oldOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=oldOrigin;d.close();}
});

test('login explains registration status only after password verification and issues no session before approval',async()=>{
  const d=new DatabaseSync(':memory:');
  d.exec(`CREATE TABLE members(email TEXT PRIMARY KEY,user_id TEXT UNIQUE,name TEXT,nickname TEXT UNIQUE,role TEXT,active INTEGER,password_hash TEXT,login_count INTEGER DEFAULT 0,last_login_at TEXT);
    CREATE TABLE login_attempts(email TEXT PRIMARY KEY,window_start INTEGER,failures INTEGER);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires_at INTEGER);
    CREATE TABLE login_logs(email TEXT,ip TEXT,user_agent TEXT,created_at TEXT);`);
  registration.initializeRegistrationSchema(d);
  const server=load('../lib/server.ts',{'node:crypto':{default:crypto},'./store.mjs':{},'./auth':{},'./download-segments.mjs':segments});
  const login=load('../app/api/auth/login/route.ts',{
    'next/server':{NextResponse:{json:body=>Object.assign(Response.json(body),{cookies:{set:()=>{}}})}},
    'node:crypto':crypto,'@/lib/store.mjs':{getConnection:()=>d},'@/lib/passwords.mjs':passwords,
    '@/lib/auth':{sessionCookie:()=>({})},'@/lib/server':server
  });
  const oldOrigin=process.env.APP_ORIGIN;process.env.APP_ORIGIN='http://localhost:3001';
  const input={name:'Login applicant',nickname:'login-applicant',email:'login-applicant@example.test',password:'Login-Applicant-2026',confirm_password:'Login-Applicant-2026',country:'US',institution:'Institute',project_name:'Project',project_summary:'Research project.'};
  let token;
  const attempt=(password=input.password)=>login.POST(new Request('http://localhost:3001/api/auth/login',{method:'POST',headers:{Origin:process.env.APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({email:input.email,password})}));
  try {
    await registration.registerMember(d,input,async mail=>{token=mail.token;});
    assert.equal((await attempt('Wrong-Password-2026')).status,401);
    let response=await attempt();assert.equal(response.status,403);assert.match((await response.json()).error,/verify your email/);
    registration.verifyRegistration(d,token);
    response=await attempt();assert.equal(response.status,403);assert.match((await response.json()).error,/awaiting administrator approval/);
    registration.reviewRegistration(d,input.email,'reject','admin@example.test');
    response=await attempt();assert.equal(response.status,403);assert.match((await response.json()).error,/not approved/);
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    registration.reviewRegistration(d,input.email,'approve','admin@example.test');
    assert.equal((await attempt()).status,200);
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
  }finally{if(oldOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=oldOrigin;d.close();}
});
