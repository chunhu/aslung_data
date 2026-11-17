import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {savePost,getPost,getPublicPost,listPublicPosts,listPosts} from '../lib/posts.mjs';
import * as language from '../lib/post-language.mjs';
import * as documents from '../lib/post-document.mjs';
import * as homepage from '../lib/homepage-content.mjs';
import * as options from '../lib/homepage-options.mjs';
const admin={email:'admin@test',role:'admin',name:'Editor'},member={email:'reader@test',role:'member'};
const input={kind:'news',title:'中文標題',summary:'中文摘要',body:'中文內文',title_en:'English title',summary_en:'English summary',body_en:'English body',pinned:false,status:'published',visibility:'public'};
test('both post kinds save, read and search independent languages; legacy updates retain translations',()=>{
 const d=new DatabaseSync(':memory:');try{for(const kind of ['news','article']){
  const saved=savePost(d,admin,{...input,kind});assert.equal(saved.body_en,'English body');
  assert.equal(language.displayPost(getPublicPost(d,saved.id),true).title,'English title');
  assert.equal(language.displayPost(getPublicPost(d,saved.id),false).title,'中文標題');
  assert.equal(listPublicPosts(d,{q:'English body',type:kind}).total,1);
  assert.equal(listPosts(d,member,{q:'English summary',type:kind}).total,1);
  const legacy={...saved,pinned:false,title:'修訂中文'};for(const f of ['title_en','summary_en','body_en','body_json_en'])delete legacy[f];
  const updated=savePost(d,admin,legacy);assert.equal(updated.body_en,'English body');assert.equal(updated.title_en,'English title');
  assert.throws(()=>savePost(d,admin,{...saved,pinned:false}),e=>e.status===409);
  assert.throws(()=>savePost(d,member,{...input,kind}),e=>e.status===403);
  const privateDraft=savePost(d,admin,{...input,kind,status:'draft',title_en:'Draft secret'});
  assert.throws(()=>getPublicPost(d,privateDraft.id),e=>e.status===404);assert.equal(listPublicPosts(d,{q:'Draft secret'}).total,0);
 }}finally{d.close();}
});
test('English drafts may be incomplete; publication validates fields atomically and legacy content falls back',()=>{
 const d=new DatabaseSync(':memory:');try{
  const draft=savePost(d,admin,{...input,title_en:'Partial',body_en:'',summary_en:'',status:'draft'});
  assert.throws(()=>savePost(d,admin,{...draft,pinned:false,status:'published'}),e=>e.status===400);
  assert.equal(getPost(d,admin,draft.id,{manage:true}).version,1);
  for(const change of [{title_en:'x'.repeat(161)},{body_en:'x'.repeat(60001)},{summary_en:'x'.repeat(501)},{body_json_en:'bad json'}])assert.throws(()=>savePost(d,admin,{...input,...change}),e=>e.status===400);
  const original=savePost(d,admin,{...input,title_en:'',summary_en:'',body_en:''});
  assert.equal(language.displayPost(original,true).body,'中文內文');assert.equal(language.displayPost(original,true).translationFallback,true);
 }finally{d.close();}
});
test('both language documents retain image references, rich formatting and safe catalogue links',()=>{
 const d=new DatabaseSync(':memory:');try{
  const base=savePost(d,admin,{...input,status:'draft'}),id='00000000-0000-4000-8000-000000000001';
  d.prepare('INSERT INTO site_post_images VALUES(?,?,?,?,?)').run(id,new Uint8Array([1]),'image/webp',admin.email,'now');
  const doc={type:'doc',content:[documents.fileCatalogueDocument(true),{type:'image',attrs:{src:'/api/posts/images?id='+id,alt:'English image'}}]};
  const saved=savePost(d,admin,{...base,pinned:false,body_json_en:JSON.stringify(doc),status:'published'});
  assert.match(saved.body_en,/Go to downloads/);assert.match(saved.body_json_en,/file-catalog\?lang=en/);
  assert.equal(d.prepare('SELECT count(*) n FROM site_post_image_refs WHERE post_id=?').get(saved.id).n,1);
  for(const href of ['//evil.test','/file-share#token=secret','/file-catalog?url=https://evil.test','javascript:alert(1)'])assert.throws(()=>documents.safePostLink(href));
  const retained=savePost(d,admin,{id:saved.id,version:saved.version,kind:'news',title:'更新中文',summary:'',body:'更新內容',pinned:false,status:'published'});
  assert.match(retained.body_json_en,/English image/);assert.equal(d.prepare('SELECT count(*) n FROM site_post_image_refs').get().n,1);
 }finally{d.close();}
});
function compile(file,deps){const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,m={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);return m.exports;}
function publicView(en){return compile('components/PublicSite.tsx',{'react/jsx-runtime':jsx,'@/components/LanguageSwitcher':{default:()=>null},'@/components/useAppLanguage':{default:()=>en?'en':'zh-TW'},'@/components/RichPostBody':{default:({document})=>React.createElement('p',null,document)},'@/components/HomepageBody':{default:()=>null},'@/lib/post-language.mjs':language,'@/lib/homepage-content.mjs':homepage,'@/lib/homepage-options.mjs':options,'lucide-react':Object.fromEntries(['Activity','ArrowRight','Database','ShieldCheck','SlidersHorizontal','FileText','ArrowUpRight','Users','CheckCircle2'].map(k=>[k,()=>null]))});}
test('public homepage cards, listings and full articles select the requested language',()=>{
 const post={...input,id:'00000000-0000-4000-8000-000000000001'};
 for(const en of [true,false]){const views=publicView(en);for(const node of [React.createElement(views.PublicPostCards,{posts:[post]}),React.createElement(views.PublicArticleListing,{feed:{rows:[post],total:1,page:1,pages:1}}),React.createElement(views.PublicArticle,{post})]){
  const html=renderToStaticMarkup(node);assert.ok(html.includes(en?'English title':'中文標題'));assert.ok(!html.includes(en?'中文標題':'English title'));
 }}
});
test('editor has separate language pages, retains drafts when switching and submits both together',async()=>{
 let index=0;const values=[true,'all','','',1,0,{rows:[],total:0,pages:0},false,false,'','',null,{...input,status:'draft'},false,false,'zh'];
 const Editor=()=>null,calls=[];
 const view=compile('components/PostsView.tsx',{'react':{...React,useState:initial=>{const i=index++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];},useRef:v=>({current:v}),useEffect:()=>{}},'react/jsx-runtime':jsx,'next/dynamic':{default:()=>Editor},'@/components/RichPostBody':{default:()=>null},'@/lib/post-language.mjs':language,'date-fns-tz':{formatInTimeZone:()=>''},'@/components/ui/button':{Button:'button'},'@/components/ui/input':{Input:'input'},'@/components/ui/textarea':{Textarea:'textarea'},'lucide-react':Object.fromEntries(['BellRing','FileText','Pin','Plus','ArrowLeft','Search'].map(k=>[k,()=>null]))}).default;
 const render=()=>{index=0;return view({kind:'news',admin:true,timezone:'Asia/Taipei',api:async(url,init)=>{calls.push(JSON.parse(init.body));}});};
 function find(n,p){if(!React.isValidElement(n))return null;if(p(n))return n;for(const c of React.Children.toArray(n.props.children)){const r=find(c,p);if(r)return r;}return null;}
 let tree=render();find(tree,n=>n.type==='button'&&n.props.children==='English').props.onClick();tree=render();
 assert.match(renderToStaticMarkup(tree),/English version/);
 find(tree,n=>n.props['aria-label']==='English title').props.onChange({target:{value:'Edited English'}});
 const editor=find(render(),n=>n.type===Editor);assert.equal(editor.props.isEnglish,true);editor.props.onChange({body:'Edited body',body_json:JSON.stringify(documents.plainPostDocument('Edited body'))});
 tree=render();find(tree,n=>n.type==='button'&&n.props.children==='繁體中文').props.onClick();tree=render();assert.equal(find(tree,n=>n.props['aria-label']==='中文標題').props.value,'中文標題');
 find(tree,n=>n.type==='button'&&n.props.children==='儲存草稿').props.onClick();await new Promise(r=>setImmediate(r));
 assert.equal(calls[0].title_en,'Edited English');assert.equal(calls[0].body_en,'Edited body');assert.equal(calls[0].body,'中文內文');
});


test('real author and publisher identities are management-only; readers receive custom bilingual bylines',()=>{
 const d=new DatabaseSync(':memory:');try{
  const actual={email:'private-person@example.test',name:'PRIVATE_REAL_NAME',role:'admin'};
  const saved=savePost(d,actual,{...input,display_author:'研究團隊',display_author_en:'Research team'});
  assert.equal(saved.author_name,'PRIVATE_REAL_NAME');assert.equal(saved.published_by,actual.email);
  for(const row of [getPublicPost(d,saved.id),getPost(d,member,saved.id),listPublicPosts(d).rows[0],listPosts(d,member).rows[0]]){
   assert.equal(row.author_name,'研究團隊');assert.equal(language.displayPost(row,true).author_name,'Research team');
   assert.doesNotMatch(JSON.stringify(row),/PRIVATE_REAL_NAME|private-person@example.test|created_by|updated_by|published_by/);
  }
  const defaultPost=savePost(d,actual,{...input});assert.equal(getPublicPost(d,defaultPost.id).author_name,'平台編輯團隊');
  const blank=savePost(d,actual,{...saved,pinned:false,display_author:'',display_author_en:''});assert.equal(getPublicPost(d,blank.id).author_name,'');assert.equal(language.displayPost(getPublicPost(d,blank.id),true).author_name,'');
  assert.throws(()=>savePost(d,actual,{...input,display_author:'X'.repeat(161)}),e=>e.status===400);
 }finally{d.close();}
});
