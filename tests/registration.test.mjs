import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initializeRegistrationSchema,registerMember,verifyRegistration,resendVerification,reviewRegistration,
  rateLimitRegistration,validateProfile,saveProfile} from '../lib/registration.mjs';
import {tokenHash,verifyPassword} from '../lib/passwords.mjs';
import {COUNTRY_CODES,countryOptions} from '../lib/countries.mjs';
import {buildDownloadSegments} from '../lib/download-segments.mjs';

function database() {
  const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE members(email TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,nickname TEXT UNIQUE,
    role TEXT NOT NULL,active INTEGER NOT NULL,password_hash TEXT NOT NULL);
    CREATE TABLE grants(id INTEGER PRIMARY KEY,email TEXT);`);
  initializeRegistrationSchema(d);return d;
}
const input={name:'International Researcher',nickname:'researcher',email:'researcher@example.test',
  password:'Researcher-Test-2026',confirm_password:'Researcher-Test-2026',country:'TH',institution:'Test University',
  project_name:'Cross-border air quality study',project_summary:'Compare air quality measurements across partner sites.',
  requested_access:'N0059, October 2026',language:'en',role:'admin',active:1};

test('registration requires verified email and review, never grants administrator or data access',async()=>{
  const d=database();let mail;
  try {
    await registerMember(d,input,async m=>{mail=m;});
    const member=d.prepare('SELECT * FROM members').get();
    assert.equal(member.role,'member');assert.equal(member.active,0);
    assert.ok(await verifyPassword(input.password,member.password_hash));
    assert.equal(d.prepare('SELECT token_hash FROM email_verifications').get().token_hash,tokenHash(mail.token));
    assert.notEqual(d.prepare('SELECT token_hash FROM email_verifications').get().token_hash,mail.token);
    assert.equal(d.prepare('SELECT country FROM member_profiles').get().country,'TH');
    assert.throws(()=>reviewRegistration(d,input.email,'approve','admin@example.test'),e=>e.status===400);
    verifyRegistration(d,mail.token);
    assert.equal(d.prepare('SELECT registration_status FROM member_profiles').get().registration_status,'pending_review');
    assert.equal(d.prepare('SELECT active FROM members').get().active,0);
    assert.throws(()=>verifyRegistration(d,mail.token),e=>e.status===400);
    reviewRegistration(d,input.email,'approve','admin@example.test','Approved for collaboration');
    assert.equal(d.prepare('SELECT active FROM members').get().active,1);
    assert.equal(d.prepare('SELECT registration_status FROM member_profiles').get().registration_status,'approved');
    assert.equal(d.prepare('SELECT COUNT(*) AS n FROM grants').get().n,0);
    assert.throws(()=>reviewRegistration(d,input.email,'approve','admin@example.test'),e=>e.status===400);
  }finally{d.close();}
});

test('expired and replaced verification tokens cannot be used; resend requires the existing password',async()=>{
  const d=database();const mail=[];
  try {
    await registerMember(d,input,async m=>{mail.push(m);});
    assert.throws(()=>verifyRegistration(d,mail[0].token,Date.now()+25*3600000),e=>e.status===400);
    await resendVerification(d,{email:input.email,password:'incorrect'},async m=>{mail.push(m);});
    assert.equal(mail.length,1);
    await resendVerification(d,input,async m=>{mail.push(m);});
    assert.equal(mail.length,2);
    assert.throws(()=>verifyRegistration(d,mail[0].token),e=>e.status===400);
    verifyRegistration(d,mail[1].token);
  }finally{d.close();}
});

test('failed delivery preserves a recoverable inactive application and rejection preserves no access',async()=>{
  const d=database();let mail;
  try {
    await assert.rejects(registerMember(d,input,async()=>{throw new Error('SMTP unavailable');}),/SMTP unavailable/);
    assert.equal(d.prepare('SELECT active FROM members').get().active,0);
    await resendVerification(d,input,async m=>{mail=m;});verifyRegistration(d,mail.token);
    reviewRegistration(d,input.email,'reject','admin@example.test','Contact the project coordinator');
    assert.equal(d.prepare('SELECT active FROM members').get().active,0);
    assert.equal(d.prepare('SELECT registration_status FROM member_profiles').get().registration_status,'rejected');
    reviewRegistration(d,input.email,'approve','admin@example.test');
    assert.equal(d.prepare('SELECT active FROM members').get().active,1);
  }finally{d.close();}
});

test('duplicate identifiers, invalid countries, long summaries, and request floods are rejected',async()=>{
  const d=database();
  try {
    await registerMember(d,input,async()=>{});
    await assert.rejects(registerMember(d,input,async()=>{}),e=>e.status===409);
    assert.throws(()=>validateProfile({...input,country:'XX'}),e=>e.status===400);
    assert.throws(()=>validateProfile({...input,project_summary:'a'.repeat(1001)}),e=>e.status===400);
    assert.throws(()=>validateProfile({...input,institution:''}),e=>e.status===400);
    assert.throws(()=>validateProfile({...input,country:''}),e=>e.status===400);
    rateLimitRegistration(d,'test-rate',2);rateLimitRegistration(d,'test-rate',2);
    assert.throws(()=>rateLimitRegistration(d,'test-rate',2),e=>e.status===429);
  }finally{d.close();}
});

test('profile edits preserve review status, and email changes cascade verification records',async()=>{
  const d=database();
  try {
    await registerMember(d,input,async()=>{});
    saveProfile(d,input.email,validateProfile({...input,country:'US',project_name:'Updated study'},false));
    assert.equal(d.prepare('SELECT registration_status FROM member_profiles').get().registration_status,'pending_email');
    d.prepare('UPDATE members SET email=? WHERE email=?').run('updated@example.test',input.email);
    assert.equal(d.prepare('SELECT email FROM member_profiles').get().email,'updated@example.test');
    assert.equal(d.prepare('SELECT email FROM email_verifications').get().email,'updated@example.test');
    assert.equal(d.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{d.close();}
});

test('legacy accounts remain active with optional blank collaboration fields',()=>{
  const d=database();
  try {
    d.prepare("INSERT INTO members VALUES('legacy@example.test','id','Legacy','legacy','member',1,'hash')").run();
    saveProfile(d,'legacy@example.test',validateProfile({},false));
    assert.equal(d.prepare('SELECT active FROM members').get().active,1);
    const profile=d.prepare('SELECT * FROM member_profiles').get();
    assert.equal(profile.country,'');assert.equal(profile.registered_at,null);assert.equal(profile.registration_status,'approved');
  }finally{d.close();}
});

test('self-registered users cannot claim maintenance access through their chosen name',()=>{
  const member={email:input.email,name:'Existing Maintainer',role:'member',allowMaintainerNameMatch:false};
  const devices=[{id:'AL-0609'}],locations=[{id:1,aslung_id:'AL-0609',maintainer:member.name,lab_id:'N0059',start_time:'2026-01-01T00:00:00Z'}];
  assert.equal(buildDownloadSegments(member,devices,locations,[]).length,0);
  assert.equal(buildDownloadSegments(member,devices,locations,[],[{name:member.name,email:member.email}]).length,1);
});

test('country choices cover 249 unique ISO codes with Chinese and English names',()=>{
  assert.equal(COUNTRY_CODES.length,249);assert.equal(new Set(COUNTRY_CODES).size,249);
  assert.equal(countryOptions('en').find(c=>c.code==='TH').name,'Thailand');
  assert.ok(countryOptions('zh-Hant').find(c=>c.code==='TH').name.includes('泰'));
});
