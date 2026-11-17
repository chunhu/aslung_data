import * as postLanguage from '../lib/post-language.mjs';
import * as activityAuditMock from './helpers/activity-audit.mjs';
import * as activityHttpSecurity from '../lib/http-security.mjs';
import * as activityNodeStream from 'node:stream';
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
  const route=compile('app/api/posts/route.ts',{'@/lib/posts.mjs':posts,'@/lib/store.mjs':{getConnection:()=>d},'@/lib/activity-server':activityAuditMock,'@/lib/http-security.mjs':activityHttpSecurity,'node:stream':activityNodeStream,'@/lib/server':{
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
  'next/dynamic':{default:()=>()=>null},'@/lib/post-language.mjs':postLanguage,'@/components/RichPostBody':{default:()=>null},
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

test('public visibility is opt-in; public lists/details expose published public posts only',()=>{
 const d=db();try{
  const memberOnly=posts.savePost(d,admin,input({kind:'article',title:'Private needle',status:'published'}));
  assert.equal(memberOnly.visibility,'members');assert.equal(posts.listPublicPosts(d).total,0);
  let draft=posts.savePost(d,admin,input({kind:'article',title:'Public needle',visibility:'public'}));
  assert.equal(posts.listPublicPosts(d,{q:'needle'}).total,0);assert.throws(()=>posts.getPublicPost(d,draft.id),e=>e.status===404);assert.throws(()=>posts.getPublicPost(d,memberOnly.id),e=>e.status===404);
  draft=posts.savePost(d,admin,{...draft,pinned:false,status:'published'});
  const feed=posts.listPublicPosts(d,{type:'article',q:'needle',limit:6});assert.equal(feed.total,1);assert.equal(feed.rows[0].id,draft.id);assert.equal('body' in feed.rows[0],false);assert.equal('created_by' in feed.rows[0],false);
  assert.equal(posts.getPublicPost(d,draft.id).visibility,'public');
  // Old clients omitting visibility preserve the already reviewed audience.
  const withoutVisibility={...draft,pinned:false};delete withoutVisibility.visibility;draft=posts.savePost(d,admin,withoutVisibility);assert.equal(draft.visibility,'public');
  draft=posts.savePost(d,admin,{...draft,pinned:false,visibility:'members'});assert.equal(posts.listPublicPosts(d).total,0);assert.throws(()=>posts.getPublicPost(d,draft.id),e=>e.status===404);
  assert.throws(()=>posts.savePost(d,admin,{...draft,pinned:false,visibility:'everyone'}),e=>e.status===400);
  assert.equal(posts.getPost(d,member,draft.id).visibility,'members');
  draft=posts.savePost(d,admin,{...draft,pinned:false,visibility:'public',status:'archived'});assert.throws(()=>posts.getPublicPost(d,draft.id),e=>e.status===404);
 }finally{d.close();}
});

test('existing published articles migrate to members-only without publishing old content',()=>{
 const d=db();try{
  d.exec(`CREATE TABLE site_posts(id TEXT PRIMARY KEY,kind TEXT,title TEXT,summary TEXT,body TEXT,status TEXT,pinned INTEGER,author_name TEXT,created_by TEXT,updated_by TEXT,created_at TEXT,updated_at TEXT,published_at TEXT,version INTEGER);
    INSERT INTO site_posts VALUES('00000000-0000-4000-8000-000000000001','article','Old private content','Private summary','Private body','published',0,'Admin','admin@test','admin@test','2026-01-01','2026-01-01','2026-01-01',1);`);
  posts.ensurePostSchema(d);assert.equal(posts.listPublicPosts(d).total,0);
  const row=posts.getPost(d,member,'00000000-0000-4000-8000-000000000001');assert.equal(row.visibility,'members');assert.equal(row.body,'Private body');assert.equal(row.body_json,null);
 }finally{d.close();}
});

test('news uses the same opt-in audience controls as articles',()=>{
 const d=db();try{
  const privateNews=posts.savePost(d,admin,input({title:'Private news',status:'published'}));
  let publicNews=posts.savePost(d,admin,input({title:'Public news',status:'published',visibility:'public'}));
  assert.deepEqual(posts.listPublicPosts(d,{type:'news'}).rows.map(row=>row.id),[publicNews.id]);
  assert.equal(posts.getPublicPost(d,publicNews.id).kind,'news');assert.throws(()=>posts.getPublicPost(d,privateNews.id),e=>e.status===404);
  assert.equal(posts.listPosts(d,member,{type:'news'}).total,2);
  publicNews=posts.savePost(d,admin,{...publicNews,pinned:false,visibility:'members'});assert.equal(posts.listPublicPosts(d,{type:'news'}).total,0);
 }finally{d.close();}
});
