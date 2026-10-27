import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as links from '../lib/file-links.mjs';
const admin={email:'admin@test.invalid',role:'admin'};
const input=(extra={})=>({name:'外部報告',url:'https://storage.example.invalid/report.pdf?signature=A%2BB&expires=999',description:'Report',emails:['member@test.invalid'],...extra});
function fixture(){const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE members(email TEXT PRIMARY KEY);INSERT INTO members VALUES('admin@test.invalid'),('member@test.invalid'),('other@test.invalid');
 CREATE TABLE files(id TEXT PRIMARY KEY,name TEXT NOT NULL,size INTEGER NOT NULL,mime_type TEXT NOT NULL,description TEXT,uploader_email TEXT REFERENCES members(email),storage_path TEXT NOT NULL,download_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
 CREATE TABLE file_grants(id INTEGER PRIMARY KEY,file_id TEXT REFERENCES files(id) ON DELETE CASCADE,email TEXT REFERENCES members(email),created_at TEXT,UNIQUE(file_id,email));
 INSERT INTO files VALUES('local','Local report',12,'text/plain','','admin@test.invalid','/existing/report.txt',7,'2026-10-01');
 INSERT INTO file_grants(file_id,email,created_at) VALUES('local','member@test.invalid','2026-10-01');`);return d;}
function compile(file,deps){const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);return module.exports;}
test('external URL accepts HTTP(S) and preserves signed queries; rejects script/file URLs, credentials and header controls',()=>{
 assert.equal(links.externalFileUrl(input().url),input().url);assert.equal(links.externalFileUrl('http://intranet.invalid/file'),'http://intranet.invalid/file');
 for(const url of ['javascript:alert(1)','data:text/html,hello','file:///etc/passwd','//example.invalid/file','https://user:pass@example.invalid/file','https://example.invalid/\r\nLocation:bad','https://example.invalid/a b','',null,'https://example.invalid/'+ 'a'.repeat(4096)])assert.throws(()=>links.externalFileUrl(url),e=>e.status===400);
});
test('migration preserves uploaded files and grants, and external links are stored atomically with deduplicated permissions',()=>{
 const d=fixture();links.ensureFileLinksSchema(d);links.ensureFileLinksSchema(d);
 assert.equal(d.prepare("SELECT external_url FROM files WHERE id='local'").get().external_url,null);
 const created=links.createFileLink(d,admin,input({emails:[' MEMBER@test.invalid ','member@test.invalid']}));
 const row=d.prepare('SELECT * FROM files WHERE id=?').get(created.fileId);
 assert.equal(row.external_url,input().url);assert.equal(row.storage_path,'');assert.equal(row.size,0);
 assert.equal(d.prepare('SELECT COUNT(*) n FROM file_grants WHERE file_id=?').get(created.fileId).n,1);
 assert.equal(d.prepare("SELECT download_count FROM files WHERE id='local'").get().download_count,7);
 assert.equal(d.prepare("SELECT COUNT(*) n FROM file_grants WHERE file_id='local'").get().n,1);
 assert.throws(()=>links.createFileLink(d,admin,input({emails:['unknown@test.invalid']})),e=>e.status===400);
 assert.equal(d.prepare('SELECT COUNT(*) n FROM files').get().n,2);
 for(const role of ['member','viewer','device_manager','calibration_manager'])assert.throws(()=>links.createFileLink(d,{...admin,role},input()),e=>e.status===403);
 d.close();
});
function routes(d){
 class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
 const calls=[];const fs={existsSync:()=>{calls.push('exists');return true;},readFileSync:()=>{calls.push('read');return Buffer.from('local bytes');},unlinkSync:()=>{calls.push('unlink');},mkdirSync:()=>{calls.push('mkdir');},writeFileSync:()=>{calls.push('write');}};
 const db=()=>({prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return d.prepare(sql).get(...args);},async all(){return {results:d.prepare(sql).all(...args)};},async run(){return d.prepare(sql).run(...args);}};}});
 const route=compile('app/api/files/route.ts',{'node:fs':{default:fs,...fs},'node:path':{default:path},'node:crypto':{default:crypto},'@/lib/store.mjs':{getConnection:()=>d},'@/lib/file-links.mjs':links,'@/lib/server':{
  AppError,db,identity:async req=>{const role=req.headers.get('test-role');if(!role)throw new AppError(401,'login');return {role,email:req.headers.get('test-email')||`${role}@test.invalid`};},
  writeGuard:req=>{if(req.headers.get('origin')!=='https://app.invalid')throw new AppError(403,'origin');},fail:e=>Response.json({error:e.message},{status:e.status||500}),
 }});return {route,calls};
}
const request=(params='',role='admin',options={})=>{const req=new Request('https://app.invalid/api/files'+params,{...options,headers:{...role?{'test-role':role}:{},origin:'https://app.invalid',...options.headers}});Object.defineProperty(req,'nextUrl',{value:new URL(req.url)});return req;};
test('file API grants protect redirects and lists, counts authorized opens and never reads or deletes external file bodies',async()=>{
 const d=fixture();links.ensureFileLinksSchema(d);const {route,calls}=routes(d);
 const created=await route.POST(request('','admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'fileLink',...input()})}));
 assert.equal(created.status,200);const {fileId}=await created.json();assert.deepEqual(calls,[]);
 assert.equal((await route.GET(request(`?id=${fileId}`,null))).status,401);
 const denied=await route.GET(request(`?id=${fileId}&download=1`,'other'));assert.equal(denied.status,403);assert.equal(denied.headers.get('location'),null);
 const opened=await route.GET(request(`?id=${fileId}&download=1`,'member'));assert.equal(opened.status,303);assert.equal(opened.headers.get('location'),input().url);
 assert.match(opened.headers.get('cache-control'),/no-store/);assert.equal(opened.headers.get('referrer-policy'),'no-referrer');assert.equal(d.prepare('SELECT download_count FROM files WHERE id=?').get(fileId).download_count,1);
 assert.deepEqual(calls,[]);assert.equal((await (await route.GET(request('','member'))).json()).files.length,2);assert.equal((await (await route.GET(request('','other'))).json()).files.length,0);
 d.prepare('DELETE FROM file_grants WHERE file_id=?').run(fileId);assert.equal((await route.GET(request(`?id=${fileId}&download=1`,'member'))).status,403);
 const local=await route.GET(request('?id=local&download=1','member'));assert.equal(local.status,200);assert.equal(await local.text(),'local bytes');assert.deepEqual(calls,['exists','read']);calls.length=0;
 d.prepare('UPDATE files SET storage_path=? WHERE id=?').run('/should-never-be-touched',fileId);
 const deleted=await route.POST(request('','admin',{method:'POST',body:JSON.stringify({action:'fileDelete',id:fileId})}));assert.equal(deleted.status,200);assert.deepEqual(calls,[]);assert.equal(d.prepare('SELECT COUNT(*) n FROM files WHERE id=?').get(fileId).n,0);d.close();
});
test('file API rejects member writes, foreign origins and invalid external links',async()=>{
 const d=fixture();links.ensureFileLinksSchema(d);const {route,calls}=routes(d);
 const body=JSON.stringify({action:'fileLink',...input()});
 assert.equal((await route.POST(request('','member',{method:'POST',body}))).status,403);
 assert.equal((await route.POST(request('','admin',{method:'POST',body,headers:{origin:'https://other.invalid'}}))).status,403);
 assert.equal((await route.POST(request('','admin',{method:'POST',body:JSON.stringify({action:'fileLink',...input({url:'javascript:alert(1)'})})}))).status,400);
 assert.equal(d.prepare('SELECT COUNT(*) n FROM files').get().n,1);assert.deepEqual(calls,[]);d.close();
});
test('resource actions use the authorized endpoint for external links and preserve ordinary file view/download actions',()=>{
 const tag=({children})=>React.createElement('div',null,children);
 const {default:View}=compile('components/FileResourceActions.tsx',{react:React,'react/jsx-runtime':jsx,'@/components/ui/button':{Button:tag},'lucide-react':{Download:()=>null,Eye:()=>null,ExternalLink:()=>null}});
 const external=renderToStaticMarkup(React.createElement(View,{file:{id:'link1',name:'Link',external_url:input().url},onDownload:()=>{}}));
 assert.ok(external.includes('/api/files?id=link1&amp;download=1'));assert.ok(external.includes('noopener noreferrer'));assert.ok(!external.includes(input().url));assert.ok(external.includes('開啟下載連結'));
 const local=renderToStaticMarkup(React.createElement(View,{file:{id:'local',name:'Local'},onDownload:()=>{}}));assert.ok(local.includes('檢視'));assert.ok(local.includes('下載'));
});
