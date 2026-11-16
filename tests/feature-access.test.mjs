import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import * as feature from '../lib/feature-access.mjs';
import * as files from '../lib/file-access.mjs';
const admin={email:'admin@test',role:'admin'},alice={email:'alice@test',role:'member'},bob={email:'bob@test',role:'member'};
function fixture(){const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE members(email TEXT PRIMARY KEY,role TEXT,active INTEGER,name TEXT);
 INSERT INTO members VALUES('admin@test','admin',1,'Admin'),('alice@test','member',1,'Alice'),('bob@test','member',1,'Bob'),('basic@test','basic',1,'Basic'),('cal@test','calibration_manager',1,'Calibration');
 CREATE TABLE files(id TEXT PRIMARY KEY,name TEXT,size INTEGER,mime_type TEXT,description TEXT,uploader_email TEXT,storage_path TEXT,external_url TEXT,download_count INTEGER DEFAULT 0,created_at TEXT);
 CREATE TABLE file_grants(id INTEGER PRIMARY KEY,file_id TEXT,email TEXT,created_at TEXT);
 INSERT INTO files(id,name,size,mime_type,uploader_email,storage_path,created_at) VALUES('f','File',5,'text/plain','admin@test','/private','2026-11-16');
 CREATE TABLE site_posts(id TEXT PRIMARY KEY,kind TEXT,status TEXT);INSERT INTO site_posts VALUES('news-id','news','published'),('article-id','article','published');
 CREATE TABLE site_post_image_refs(post_id TEXT,image_id TEXT);INSERT INTO site_post_image_refs VALUES('news-id','image-n'),('article-id','image-a');`);return d;}
const policy=(d,id,extra={})=>{feature.ensureFeatureAccessSchema(d);const current=feature.featureAdminState(d,admin).features.find(f=>f.id===id);return feature.saveFeaturePolicy(d,admin,{feature:id,mode:'selected',emails:[],group_ids:[],revision:current.revision,...extra});};
test('unconfigured defaults preserve roles; an allowlist cannot elevate a role or lock out administrators',()=>{
 const d=fixture();try{
  assert.equal(feature.featureAccess(d,alice).data,true);assert.equal(feature.featureAccess(d,{email:'basic@test'}).data,false);assert.equal(feature.featureAccess(d,alice).members,false);
  policy(d,'members',{emails:['alice@test']});assert.equal(feature.featureAccess(d,alice).members,false);
  policy(d,'news');assert.equal(feature.featureAccess(d,alice).news,false);assert.equal(feature.featureAccess(d,admin).news,true);
  policy(d,'feature-access');assert.equal(feature.featureAccess(d,admin)['feature-access'],true);
  assert.throws(()=>feature.saveFeaturePolicy(d,{email:'alice@test',role:'admin'},{feature:'news',mode:'role',revision:1,emails:[],group_ids:[]}),e=>e.status===403);
 }finally{d.close();}
});
test('individual and group subjects are OR-ed, group membership updates both file access and features',()=>{
 const d=fixture();try{
  files.ensureFileAccessSchema(d);
  const group=feature.saveSharedGroup(d,admin,{action:'groupSave',name:'Project',emails:['bob@test']});
  policy(d,'files',{emails:['alice@test'],group_ids:[group.id]});
  files.fileManagementAction(d,admin,{action:'permissionSave',resource_type:'file',resource_id:'f',subject_type:'group',subject_id:group.id,permissions:{view:true,download:true,manage:false,grant:false}});
  assert.equal(feature.featureAccess(d,bob).files,true);assert.equal(feature.featureAccess(d,alice).files,true);assert.equal(files.fileContext(d,bob).effective('file','f').download,true);
  // The original file manager edits the very same group, and records the change.
  files.fileManagementAction(d,admin,{action:'groupSave',id:group.id,revision:1,name:'Renamed',emails:[]});
  assert.equal(feature.featureAccess(d,bob).files,false);assert.equal(feature.featureAccess(d,alice).files,true);assert.equal(files.fileContext(d,bob).effective('file','f').download,false);
  const events=feature.featureAdminState(d,admin).events;assert.equal(events[0].target,group.id);assert.match(events[0].before_state,/bob@test/);
  feature.saveSharedGroup(d,admin,{action:'groupDelete',id:group.id,revision:2});assert.equal(feature.featureAccess(d,bob).files,false);assert.equal(feature.featureAdminState(d,admin).features.find(f=>f.id==='files').mode,'selected');
 }finally{d.close();}
});
test('stale revisions and invalid subjects roll back settings and audit entries',()=>{
 const d=fixture();try{
  policy(d,'data',{emails:['alice@test']});const events=feature.featureAdminState(d,admin).events.length;
  assert.throws(()=>feature.saveFeaturePolicy(d,admin,{feature:'data',mode:'role',emails:[],group_ids:[],revision:0}),e=>e.status===409);
  assert.throws(()=>policy(d,'data',{emails:['missing@test']}));assert.throws(()=>policy(d,'data',{group_ids:['missing']}));
  assert.equal(feature.featureAdminState(d,admin).events.length,events);assert.equal(feature.featureAccess(d,bob).data,false);
  policy(d,'data',{mode:'role'});assert.equal(feature.featureAccess(d,bob).data,true);
  d.exec("UPDATE members SET active=0 WHERE email='admin@test'");assert.throws(()=>policy(d,'news'));assert.throws(()=>feature.featureAccess(d,admin));
 }finally{d.close();}
});
test('removing a selected account or group leaves the policy restricted, never opens it to everyone',()=>{
 const d=fixture();try{
  policy(d,'news',{emails:['alice@test']});d.exec("DELETE FROM members WHERE email='alice@test'");assert.equal(feature.featureAccess(d,bob).news,false);
  const g=feature.saveSharedGroup(d,admin,{action:'groupSave',name:'Group',emails:['bob@test']});policy(d,'articles',{group_ids:[g.id]});
  feature.saveSharedGroup(d,admin,{action:'groupDelete',id:g.id,revision:1});assert.equal(feature.featureAccess(d,bob).articles,false);
 }finally{d.close();}
});
test('central request gate covers API routes, post IDs, private images, API tokens and cloned manage bodies',async()=>{
 const d=fixture();try{
  for(const id of ['data','files','articles','realtime','personal','connection'])policy(d,id);
  const denied=['/api/data','/api/files?id=f&download=1','/api/posts?id=article-id','/api/posts?kind=article','/api/posts/images?id=image-a','/api/realtime','/api/personal','/api/processing?id=job','/api/manage?scope=data'];
  for(const path of denied)await assert.rejects(feature.assertFeatureRequest(d,alice,new Request('http://test'+path,{headers:{Authorization:'Bearer ignored-by-this-layer'}})),e=>e.status===403,path);
  await feature.assertFeatureRequest(d,alice,new Request('http://test/api/posts?id=news-id'));await feature.assertFeatureRequest(d,alice,new Request('http://test/api/posts/images?id=image-n'));
  await feature.assertFeatureRequest(d,alice,new Request('http://test/api/manage?scope=bootstrap'));await feature.assertFeatureRequest(d,alice,new Request('http://test/api/manage?scope=full'));
  const request=new Request('http://test/api/manage',{method:'POST',body:JSON.stringify({action:'tokenCreate'})});await assert.rejects(feature.assertFeatureRequest(d,alice,request),e=>e.status===403);assert.equal((await request.json()).action,'tokenCreate');
  await feature.assertFeatureRequest(d,alice,new Request('http://test/api/auth/password',{method:'POST',body:'{}'}));
 }finally{d.close();}
});
test('admin preview, active member validation and group optimistic revisions are authoritative',()=>{
 const d=fixture();try{
  const g=feature.saveSharedGroup(d,admin,{action:'groupSave',name:'Project',emails:['alice@test']});
  assert.throws(()=>feature.saveSharedGroup(d,admin,{action:'groupSave',id:g.id,revision:0,name:'Other',emails:['bob@test']}),e=>e.status===409);
  policy(d,'data',{group_ids:[g.id]});const state=feature.featureAdminState(d,admin,{preview_email:'bob@test'});assert.equal(state.preview.data,false);assert.equal(state.groups[0].emails[0],'alice@test');
  assert.throws(()=>feature.featureAdminState(d,alice));d.exec("UPDATE members SET active=0 WHERE email='alice@test'");assert.throws(()=>feature.featureAccess(d,alice));
 }finally{d.close();}
});
