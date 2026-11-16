import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import * as g from '../lib/guest-files.mjs';
const now=Date.parse('2026-11-16T00:00:00Z'),admin={email:'admin@test',role:'admin'};
const person={email:'Guest@Example.test',name:'Researcher',organization:'Institute',purpose:'Research'};
const input={...person,file_id:'f',expires_at:new Date(now+86400000).toISOString(),max_downloads:2};
function fixture(){const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE members(email TEXT PRIMARY KEY,role TEXT,active INTEGER);INSERT INTO members VALUES('admin@test','admin',1),('basic@test','basic',1);
 CREATE TABLE files(id TEXT PRIMARY KEY,name TEXT,description TEXT,size INTEGER,mime_type TEXT,storage_path TEXT,external_url TEXT,download_count INTEGER DEFAULT 0,created_at TEXT);
 INSERT INTO files VALUES('f','Data.csv','Research data',12,'text/csv','/private/files/secret.csv',NULL,0,'2026-11-01'),('url','External','External source',0,'application/octet-stream','','https://secret.test/hidden?key=hidden',0,'2026-11-01');`);g.ensureGuestFileSchema(d);return d;}
function verified(d,share,time=now){const otp=g.beginGuestDownload(d,share.token,time);return g.verifyGuestDownload(d,{token:share.token,code:otp.code},time);}

test('public metadata is opt-in, safe, searchable and does not grant downloads or weaken existing membership',()=>{
 const d=fixture();try{
  assert.equal(g.publicGuestFiles(d).total,0);
  assert.throws(()=>g.setGuestPublication(d,{email:'basic@test',role:'admin'},{file_id:'f',enabled:true}),e=>e.status===403);
  g.setGuestPublication(d,admin,{file_id:'f',enabled:true});g.setGuestPublication(d,admin,{file_id:'url',enabled:true});
  const feed=g.publicGuestFiles(d,{q:'data'});assert.equal(feed.total,1);assert.deepEqual(Object.keys(feed.rows[0]).sort(),['description','id','name','size']);
  assert.ok(!JSON.stringify(g.publicGuestFiles(d)).includes('secret'));assert.ok(!JSON.stringify(g.publicGuestFiles(d)).includes('hidden'));
  assert.throws(()=>g.guestDownloadFile(d,'f',now),e=>e.status===403);
  assert.throws(()=>g.publicGuestFiles(d,{page:-1}));
 }finally{d.close();}
});
test('requests require email verification, cannot self-approve and approval creates an independent recipient-bound link',()=>{
 const d=fixture();try{
  assert.throws(()=>g.beginGuestRequest(d,input,now),e=>e.status===404);
  g.setGuestPublication(d,admin,{file_id:'f',enabled:true});
  const r=g.beginGuestRequest(d,{...input,status:'approved'},now);
  assert.equal(g.guestAdminOverview(d,admin).requests.total,0);
  assert.throws(()=>g.reviewGuestRequest(d,admin,{id:r.id,decision:'approve',...input},now),e=>e.status===409);
  g.verifyGuestRequest(d,{id:r.id,code:r.code},now);assert.equal(g.guestAdminOverview(d,admin).requests.rows[0].status,'pending');
  assert.throws(()=>g.reviewGuestRequest(d,admin,{id:r.id,decision:'approve',...input,max_downloads:0},now));
  assert.equal(d.prepare('SELECT status FROM guest_file_requests').get().status,'pending');assert.equal(d.prepare('SELECT COUNT(*) n FROM guest_file_shares').get().n,0);
  const share=g.reviewGuestRequest(d,admin,{id:r.id,decision:'approve',...input,email:'attacker@test'},now);
  assert.equal(share.email,'guest@example.test');assert.equal(d.prepare('SELECT status FROM guest_file_requests').get().status,'approved');
  assert.throws(()=>g.reviewGuestRequest(d,admin,{id:r.id,decision:'approve',...input},now),e=>e.status===409);
  const token=verified(d,share);assert.equal(token.name,'Data.csv');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM members').get().n,2);
 }finally{d.close();}
});
test('OTP expiry, five-attempt lockout, replay, resend invalidation and hashed secret storage',()=>{
 const d=fixture();try{
  const share=g.createGuestShare(d,admin,input,now),otp=g.beginGuestDownload(d,share.token,now);
  for(let i=0;i<5;i++)assert.throws(()=>g.verifyGuestDownload(d,{token:share.token,code:'bad'},now));
  assert.throws(()=>g.verifyGuestDownload(d,{token:share.token,code:otp.code},now),/失效/);
  const fresh=g.beginGuestDownload(d,share.token,now);
  assert.throws(()=>g.verifyGuestDownload(d,{token:share.token,code:fresh.code},now+600001),/失效/);
  const third=g.beginGuestDownload(d,share.token,now+600002);
  const v=g.verifyGuestDownload(d,{token:share.token,code:third.code},now+600002);
  assert.throws(()=>g.verifyGuestDownload(d,{token:share.token,code:third.code},now+600002));
  const stored=JSON.stringify({shares:d.prepare('SELECT * FROM guest_file_shares').all(),sessions:d.prepare('SELECT * FROM guest_file_sessions').all(),codes:d.prepare('SELECT * FROM guest_file_codes').all()});
  assert.ok(!stored.includes(share.token));assert.ok(!stored.includes(v.session));
  assert.throws(()=>g.guestDownloadFile(d,v.session,now+600002+1800000),/到期/);
 }finally{d.close();}
});
test('quota is reserved atomically, interrupted transfers count, completion is immutable and filters/export agree',async()=>{
 const d=fixture();try{
  const share=g.createGuestShare(d,admin,{...input,max_downloads:1,organization:'=HYPERLINK("unsafe")'},now),v=verified(d,share);
  const outcomes=await Promise.allSettled([1,2,3].map(async()=>g.reserveGuestDownload(d,v.session,{ip:'127.0.0.1',userAgent:'Test'},now)));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  const id=outcomes.find(r=>r.status==='fulfilled').value.id;g.finishGuestDownload(d,id,'interrupted',7);g.finishGuestDownload(d,id,'completed',12);
  const result=g.guestAdminOverview(d,admin,{q:'Researcher',file_id:'f',download_status:'interrupted'});assert.equal(result.downloads.total,1);assert.equal(result.downloads.rows[0].bytes,7);
  assert.equal(d.prepare('SELECT used_downloads FROM guest_file_shares').get().used_downloads,1);assert.equal(d.prepare('SELECT download_count FROM files WHERE id=?').get('f').download_count,1);
  const csv=g.exportGuestDownloads(d,admin,{q:'Researcher',download_status:'interrupted'});assert.match(csv,/interrupted/);assert.ok(csv.includes("'=HYPERLINK"));assert.ok(!csv.includes(share.token));
  assert.equal(g.guestAdminOverview(d,admin,{q:'missing'}).downloads.total,0);
 }finally{d.close();}
});
test('disable, expiry, reissue, removed file and changed admin access immediately invalidate grants',()=>{
 const d=fixture();try{
  const share=g.createGuestShare(d,admin,input,now),v=verified(d,share);
  const renewed=g.reissueGuestShare(d,admin,{id:share.id},now);assert.throws(()=>g.beginGuestDownload(d,share.token,now));assert.throws(()=>g.guestDownloadFile(d,v.session,now));
  const v2=verified(d,renewed);g.disableGuestShare(d,admin,{id:share.id});assert.throws(()=>g.guestDownloadFile(d,v2.session,now));assert.throws(()=>g.beginGuestDownload(d,renewed.token,now));
  const expired=g.createGuestShare(d,admin,input,now);assert.throws(()=>g.beginGuestDownload(d,expired.token,now+86400000));
  const missing=g.createGuestShare(d,admin,input,now),v3=verified(d,missing);d.exec("DELETE FROM files WHERE id='f'");assert.throws(()=>g.reserveGuestDownload(d,v3.session,{},now));
  d.exec("UPDATE members SET active=0 WHERE email='admin@test'");assert.throws(()=>g.disableGuestShare(d,admin,{id:expired.id}));assert.throws(()=>g.exportGuestDownloads(d,admin));
 }finally{d.close();}
});
test('rate limits block repeated issuance, malformed fields are rejected and requests can be rejected without a share',()=>{
 const d=fixture();try{
  for(const p of [{email:'bad'},{name:''},{organization:''},{purpose:'x'.repeat(2001)},{max_downloads:1.5},{expires_at:'2020-01-01Z'}])assert.throws(()=>g.createGuestShare(d,admin,{...input,...p},now));
  const share=g.createGuestShare(d,admin,input,now);for(let i=0;i<5;i++)g.beginGuestDownload(d,share.token,now);assert.throws(()=>g.beginGuestDownload(d,share.token,now),e=>e.status===429);
  g.setGuestPublication(d,admin,{file_id:'f',enabled:true});const r=g.beginGuestRequest(d,input,now);g.verifyGuestRequest(d,{id:r.id,code:r.code},now);g.reviewGuestRequest(d,admin,{id:r.id,decision:'reject'},now);
  assert.equal(d.prepare('SELECT status FROM guest_file_requests').get().status,'rejected');assert.equal(d.prepare('SELECT COUNT(*) n FROM guest_file_shares').get().n,1);
 }finally{d.close();}
});
