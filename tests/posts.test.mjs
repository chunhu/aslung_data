import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {formatInTimeZone} from 'date-fns-tz';
import * as posts from '../lib/posts.mjs';
const admin={email:'admin@example.invalid',name:'Admin',role:'admin'},member={email:'member@example.invalid',role:'member'};
const input=(extra={})=>({kind:'news',title:'公告',summary:'',body:'第一段\n\n第二段',pinned:false,status:'draft',...extra});
const db=()=>new DatabaseSync(':memory:');

test('draft/publish/archive/republish lifecycle preserves author, publication date and audit, without exposing hidden posts',()=>{
  const d=db();const draft=posts.savePost(d,admin,input(),'2026-10-27T00:00:00Z');
  assert.equal(draft.summary,'第一段\n\n第二段');assert.equal(posts.listPosts(d,member).total,0);
  assert.throws(()=>posts.getPost(d,member,draft.id),e=>e.status===404);
  const live=posts.savePost(d,admin,{...draft,pinned:true,status:'published'},'2026-10-27T01:00:00Z');
  assert.equal(posts.listPosts(d,member).total,1);assert.equal(posts.getPost(d,member,live.id).body,draft.body);
  assert.ok(!('created_by' in posts.getPost(d,member,live.id)));
  const archived=posts.savePost(d,{...admin,email:'other-admin@example.invalid'}, {...live,pinned:true,status:'archived'});
  assert.equal(posts.listPosts(d,member).total,0);assert.equal(posts.listPosts(d,admin,{manage:true}).total,1);
  const republished=posts.savePost(d,admin,{...archived,pinned:true,status:'published'});
  assert.equal(republished.published_at,live.published_at);assert.equal(republished.author_name,'Admin');
  const hidden=posts.savePost(d,admin,{...republished,pinned:true,status:'draft'});
  assert.equal(posts.listPosts(d,member).total,0);assert.equal(hidden.version,5);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM site_post_events').get().n,5);d.close();
});
test('only admin can write or request management views; stale updates cannot overwrite a newer edit',()=>{
  const d=db(),saved=posts.savePost(d,admin,input());
  for(const role of ['member','viewer','device_manager','calibration_manager']){
    const actor={...member,role};assert.throws(()=>posts.savePost(d,actor,input()),e=>e.status===403);
    assert.throws(()=>posts.listPosts(d,actor,{manage:true}),e=>e.status===403);
    assert.throws(()=>posts.getPost(d,actor,saved.id,{manage:true}),e=>e.status===403);
  }
  assert.throws(()=>posts.listPosts(d,null),e=>e.status===401);
  const edited=posts.savePost(d,admin,{...saved,pinned:false,title:'新標題'});
  assert.throws(()=>posts.savePost(d,admin,{...saved,pinned:false,title:'過期標題'}),e=>e.status===409);
  assert.equal(posts.getPost(d,admin,saved.id,{manage:true}).title,edited.title);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM site_post_events').get().n,2);d.close();
});
test('feed separates articles/news, paginates, pins posts and searches literal text without leaking drafts',()=>{
  const d=db();
  for(let i=0;i<23;i++)posts.savePost(d,admin,input({title:`News ${i}`,pinned:i===0,status:'published'}),new Date(Date.UTC(2026,9,1+i)).toISOString());
  posts.savePost(d,admin,input({kind:'article',title:'Article',status:'published'}));
  posts.savePost(d,admin,input({body:'hidden target'}));
  assert.equal(posts.listPosts(d,member).rows[0].title,'News 0');
  assert.equal(posts.listPosts(d,member,{page:2}).rows.length,3);
  assert.equal(posts.listPosts(d,member,{type:'article'}).total,1);
  assert.equal(posts.listPosts(d,member,{q:'hidden target'}).total,0);
  assert.equal(posts.listPosts(d,admin,{manage:true,status:'draft',q:'hidden target'}).total,1);
  assert.equal(posts.listPosts(d,member,{q:"%' OR 1=1 --"}).total,0);
  for(const page of [0,-1,1.5,Infinity])assert.throws(()=>posts.listPosts(d,member,{page}),e=>e.status===400);
  d.close();
});
test('post validation rejects oversized or malformed fields and requires a valid existing version',()=>{
  const d=db();
  for(const change of [{title:''},{title:'x'.repeat(161)},{body:'x'.repeat(60001)},{summary:'x'.repeat(501)},{kind:'unknown'},{status:'invalid'},{pinned:'true'}]){
    assert.throws(()=>posts.savePost(d,admin,input(change)),e=>e.status===400);
  }
  const saved=posts.savePost(d,admin,input());
  assert.throws(()=>posts.savePost(d,admin,{...saved,pinned:false,version:undefined}),e=>e.status===409);
  assert.equal(posts.getPost(d,admin,saved.id,{manage:true}).version,1);d.close();
});
function compile(file,deps){const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);return module.exports;}
test('HTTP boundary rejects anonymous/member writes and foreign origins; unpublished content cannot be fetched by ID',async()=>{
  const d=db();class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const route=compile('app/api/posts/route.ts',{'@/lib/posts.mjs':posts,'@/lib/store.mjs':{getConnection:()=>d},'@/lib/server':{
    AppError,identity:async req=>{const role=req.headers.get('test-role');if(!role)throw new AppError(401,'login');return {...admin,role};},
    writeGuard:req=>{if(req.headers.get('origin')!=='https://site.invalid')throw new AppError(403,'origin');},fail:e=>Response.json({error:e.message},{status:e.status||500}),
  }});
  const request=(role,payload,origin='https://site.invalid')=>new Request('https://site.invalid/api/posts',{method:'POST',headers:{origin,...role?{'test-role':role}:{}},body:JSON.stringify(payload)});
  assert.equal((await route.POST(request(null,input()))).status,401);
  assert.equal((await route.POST(request('member',input()))).status,403);
  assert.equal((await route.POST(request('admin',input(),'https://other.invalid'))).status,403);
  const created=await route.POST(request('admin',input()));assert.equal(created.status,200);const draft=await created.json();
  assert.equal((await route.GET(new Request(`https://site.invalid/api/posts?id=${draft.id}`,{headers:{'test-role':'member'}}))).status,404);
  assert.equal((await route.GET(new Request('https://site.invalid/api/posts?manage=1',{headers:{'test-role':'viewer'}}))).status,403);
  const feed=await route.GET(new Request('https://site.invalid/api/posts',{headers:{'test-role':'member'}}));assert.match(feed.headers.get('cache-control'),/no-store/);
  assert.equal((await feed.json()).total,0);d.close();
});
function component(states=[]){let index=0;const tag=({children})=>React.createElement('div',null,children);return compile('components/PostsView.tsx',{
  react:{...React,useState:value=>[index<states.length?states[index++]:((index++,value)),()=>{}],useEffect:()=>{},useRef:value=>({current:value})},'react/jsx-runtime':jsx,
  'date-fns-tz':{formatInTimeZone},'@/components/ui/button':{Button:tag},'@/components/ui/input':{Input:props=>React.createElement('input',props)},'@/components/ui/textarea':{Textarea:props=>React.createElement('textarea',props)},
  'lucide-react':Object.fromEntries(['BellRing','FileText','Pin','Plus','ArrowLeft','Search'].map(key=>[key,()=>null])),
});}
test('reader hides publishing controls, admin editor supports preview, and post HTML is rendered as escaped text',()=>{
  const views=component();const props={api:()=>{},kind:'news',admin:false,timezone:'Asia/Taipei'};
  const html=renderToStaticMarkup(React.createElement(views.default,props));assert.ok(!html.includes('管理發布'));assert.ok(!html.includes('新增'));
  const content=renderToStaticMarkup(React.createElement(views.PostBody,{body:'<script>alert(1)</script>\n\nhttps://example.invalid/a\n\njavascript:alert(1)'}));
  assert.ok(content.includes('&lt;script&gt;'));assert.ok(!content.includes('<script>'));assert.ok(content.includes('href="https://example.invalid/a"'));assert.ok(!content.includes('href="javascript:'));
  const editor=component([true,'all','','',1,0,{rows:[],total:0,pages:0},false,false,'','',null,input(),false]);
  const editHtml=renderToStaticMarkup(React.createElement(editor.default,{...props,admin:true}));assert.ok(editHtml.includes('儲存草稿'));assert.ok(editHtml.includes('儲存並發布'));assert.ok(editHtml.includes('預覽文章'));
});
