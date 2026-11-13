import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureFileAccessSchema,fileManagementAction as act,fileContext,requireFileRight,fileWorkspace,filePermissionList,accessibleFileMetadata,withFileWrite,replaceLegacyFileGrants} from '../lib/file-access.mjs';
const admin={email:'admin@test',role:'admin'},alice={email:'alice@test',role:'member'},bob={email:'bob@test',role:'member'},carol={email:'carol@test',role:'member'};
function fixture(){const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE members(email TEXT PRIMARY KEY,role TEXT NOT NULL,active INTEGER DEFAULT 1);
INSERT INTO members(email,role) VALUES('admin@test','admin'),('alice@test','member'),('bob@test','member'),('carol@test','member');
CREATE TABLE files(id TEXT PRIMARY KEY,name TEXT,size INTEGER,mime_type TEXT,description TEXT,uploader_email TEXT,storage_path TEXT,external_url TEXT,download_count INTEGER DEFAULT 0,created_at TEXT);
CREATE TABLE file_grants(id INTEGER PRIMARY KEY,file_id TEXT REFERENCES files(id) ON DELETE CASCADE,email TEXT REFERENCES members(email),created_at TEXT,UNIQUE(file_id,email));
INSERT INTO files(id,name,size,mime_type,uploader_email,storage_path,external_url,created_at) VALUES('f','Private',4,'text/plain','admin@test','/private/secret',NULL,'2026-01-01T00:00:00Z'),('url','Link',0,'application/x-external-link','admin@test','','https://secret.invalid/token','2026-01-01T00:00:00Z');
INSERT INTO file_grants(file_id,email,created_at) VALUES('f','alice@test','2026-01-01');`);ensureFileAccessSchema(d);return d;}
const rights=(extra={})=>({view:true,download:false,manage:false,grant:false,...extra});
const permission=(d,actor=admin,extra={})=>act(d,actor,{action:'permissionSave',resource_type:'file',resource_id:'f',subject_type:'user',subject_id:'bob@test',permissions:rights(),...extra});
const allowed=(d,actor,id='f',type='file')=>fileContext(d,actor).effective(type,id);
const denied=work=>assert.throws(work,e=>e.status===403);
const future=()=>new Date(Date.now()+3600000).toISOString();
const past=()=>new Date(Date.now()-3600000).toISOString();

test('legacy migration preserves view/download and private storage is absent from all lists',()=>{const d=fixture();
assert.deepEqual(allowed(d,alice),rights({download:true}));assert.deepEqual(allowed(d,bob),rights({view:false}));
ensureFileAccessSchema(d);assert.equal(d.prepare('SELECT COUNT(*) n FROM file_permissions').get().n,1);
const items=accessibleFileMetadata(d,alice);assert.equal(items.length,1);assert.equal('storage_path' in items[0],false);assert.equal('external_url' in items[0],false);
replaceLegacyFileGrants(d,admin,'f',[]);assert.equal(allowed(d,alice).view,false);d.close();});

test('folder groups inherit rights; membership removal, inactive accounts and role spoofing cannot retain access',()=>{const d=fixture();
const folder=act(d,admin,{action:'folderSave',name:'Research'}).id;
act(d,admin,{action:'fileUpdate',id:'url',name:'Link',folder_id:folder});
const group=act(d,admin,{action:'groupSave',name:'Team',emails:['bob@test']}).id;
permission(d,admin,{resource_type:'folder',resource_id:folder,subject_type:'group',subject_id:group,permissions:rights({download:true})});
assert.equal(allowed(d,bob,'url').download,true);assert.equal(fileWorkspace(d,bob,{folder}).files.length,1);
assert.equal('external_url' in fileWorkspace(d,bob,{folder}).files[0],false);
act(d,admin,{action:'groupSave',id:group,revision:1,name:'Team',emails:[]});assert.equal(allowed(d,bob,'url').view,false);
assert.throws(()=>act(d,admin,{action:'groupSave',id:group,revision:1,name:'Team',emails:['bob@test']}),e=>e.status===409);
denied(()=>act(d,{...bob,role:'admin'},{action:'folderSave',name:'Forged'}));
d.prepare("UPDATE members SET active=0 WHERE email='alice@test'").run();denied(()=>fileContext(d,alice));d.close();});

test('four rights enforce separate actions and folder operations remain scoped',()=>{const d=fixture();
permission(d,admin,{permissions:rights({manage:true})});assert.equal(allowed(d,bob).download,false);assert.equal(allowed(d,bob).grant,false);
act(d,bob,{action:'fileUpdate',id:'f',name:'Renamed'});denied(()=>permission(d,bob));denied(()=>requireFileRight(fileContext(d,bob),'file','f','download'));
const folder=act(d,admin,{action:'folderSave',name:'Uploads'}).id;
permission(d,admin,{resource_type:'folder',resource_id:folder,permissions:rights({manage:true})});assert.equal(withFileWrite(d,bob,folder,()=>42),42);
denied(()=>withFileWrite(d,bob,'root',()=>42));denied(()=>act(d,bob,{action:'fileUpdate',id:'f',name:'Moved',folder_id:folder}));
act(d,admin,{action:'fileUpdate',id:'url',name:'Link',folder_id:folder});
assert.throws(()=>act(d,admin,{action:'folderDelete',id:folder}),e=>e.status===409);assert.throws(()=>act(d,admin,{action:'folderDelete',id:'root'}),e=>e.status===400);
const share=permission(d,admin,{subject_id:'carol@test',permissions:rights({grant:true})});
assert.equal(allowed(d,carol).download,false);denied(()=>act(d,carol,{action:'fileUpdate',id:'f',name:'No'}));denied(()=>act(d,carol,{action:'permissionDelete',id:share.id}));d.close();});

test('time boundaries are start inclusive/end exclusive and newly changed validity applies immediately',()=>{const d=fixture();
const start=past(),end=future(),grant=permission(d,admin,{valid_from:start,valid_until:end});
assert.equal(fileContext(d,bob,Date.parse(start)-1).effective('file','f').view,false);
assert.equal(fileContext(d,bob,Date.parse(start)).effective('file','f').view,true);
assert.equal(fileContext(d,bob,Date.parse(end)).effective('file','f').view,false);
d.prepare('UPDATE file_permissions SET valid_until=? WHERE id=?').run(past(),grant.id);assert.equal(allowed(d,bob).view,false);
assert.throws(()=>permission(d,admin,{valid_from:'2026-01-01'}),e=>e.status===400);
assert.throws(()=>permission(d,admin,{valid_from:end,valid_until:start}),e=>e.status===400);d.close();});

test('delegation caps rights and duration, revoking parent revokes descendants',()=>{const d=fixture(),end=future();
const parent=permission(d,admin,{permissions:rights({grant:true}),valid_from:past(),valid_until:end});
denied(()=>permission(d,bob,{subject_id:'carol@test',permissions:rights({download:true}),valid_until:end}));
denied(()=>permission(d,bob,{subject_id:'carol@test'}));
const child=permission(d,bob,{subject_id:'carol@test',valid_until:end});assert.equal(allowed(d,carol).view,true);
assert.equal(filePermissionList(d,bob,'file','f').permissions.find(row=>row.id===child.id).canRevoke,true);
act(d,admin,{action:'permissionDelete',id:parent.id});assert.equal(allowed(d,carol).view,false);assert.equal(d.prepare('SELECT 1 FROM file_permissions WHERE id=?').get(child.id),undefined);d.close();});

test('group removal and issuer suspension invalidate delegated grants without waiting for cache expiry',()=>{const d=fixture();
const group=act(d,admin,{action:'groupSave',name:'Delegates',emails:['bob@test']}).id;
permission(d,admin,{subject_type:'group',subject_id:group,permissions:rights({grant:true})});
permission(d,bob,{subject_id:'carol@test'});assert.equal(allowed(d,carol).view,true);
d.prepare("UPDATE members SET active=0 WHERE email='bob@test'").run();assert.equal(allowed(d,carol).view,false);
d.prepare("UPDATE members SET active=1 WHERE email='bob@test'").run();assert.equal(allowed(d,carol).view,true);
act(d,admin,{action:'groupSave',id:group,revision:1,name:'Delegates',emails:[]});assert.equal(allowed(d,carol).view,false);d.close();});

test('future grants are invisible and invalid resource kinds are rejected',()=>{const d=fixture();permission(d,admin,{valid_from:future()});assert.equal(fileWorkspace(d,bob).files.length,0);assert.throws(()=>filePermissionList(d,admin,'bad','root'),e=>e.status===400);d.close();});
