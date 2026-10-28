import * as realtimeSettings from '../lib/realtime-settings.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as names from '../lib/maintainer-names.mjs';
function load(file,deps){const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);return module.exports;}

test('explicit English names are displayed in full while missing translations retain the canonical name',()=>{
 const people=[{name:'維護甲',english_name:'  Complete English Name  '},{name:'維護乙',english_name:''}];
 assert.equal(names.maintainerDisplayName('維護甲',people,true),'Complete English Name');
 assert.equal(names.maintainerDisplayName('維護甲',people,false),'維護甲');
 assert.equal(names.maintainerDisplayName('維護乙',people,true),'維護乙');
 assert.equal(names.maintainerDisplayName('歷史人員',people,true),'歷史人員');
});
test('maintainer list protects names from translation, removes initials, and searches English names',()=>{
 const react={...React,default:React},nameComponents=load('../components/MaintainerName.tsx',{'react':react,'react/jsx-runtime':jsx,'@/lib/maintainer-names.mjs':names});
 const tag=type=>({children,...p})=>React.createElement(type,{className:p.className},children);
 const View=load('../components/MaintainersView.tsx',{
   react:react,'react/jsx-runtime':jsx,'@/components/MaintainerName':nameComponents,
   'lucide-react':Object.fromEntries(['UserCheck','CloudDownload','Plus','Trash2','Pencil','Mail','AlertTriangle','CheckCircle2'].map(k=>[k,()=>null])),
   '@/components/ui/button':{Button:tag('button')},'@/components/ui/input':{Input:tag('input')},
   '@/components/ui/table':Object.fromEntries(Object.entries({Table:'table',TableHeader:'thead',TableRow:'tr',TableHead:'th',TableBody:'tbody',TableCell:'td'}).map(([key,type])=>[key,tag(type)])),
   '@/components/ui/empty':Object.fromEntries(['Empty','EmptyHeader','EmptyTitle','EmptyDescription','EmptyMedia'].map(k=>[k,tag('div')]))
 }).default;
 const people=[{name:'維護甲',english_name:'Complete English Name',email:'tech@example.test'}];
 const props={maintainers:people,devices:[],locations:[],realtimeData:[],search:'complete',setSearch:()=>{},selectedMaintainers:new Set(),setSelectedMaintainers:()=>{},setEditMaintainer:()=>{},setModal:()=>{},setConfirmation:()=>{}};
 const render=en=>renderToStaticMarkup(React.createElement(nameComponents.MaintainerNamesProvider,{maintainers:people,isEnglish:en},React.createElement(View,props)));
 assert.match(render(true),/translate="no" class="notranslate">Complete English Name<\/span>/);
 assert.match(render(false),/>維護甲<\/span>/);assert.doesNotMatch(render(true),/w-7 h-7/);
});

test('maintainer API saves English names and sheet sync without the column preserves manual names',async()=>{
 const d=new DatabaseSync(':memory:');d.exec(`CREATE TABLE maintainers(name TEXT PRIMARY KEY,email TEXT,email_test TEXT,phone TEXT,notes TEXT,created_at TEXT,english_name TEXT NOT NULL DEFAULT '');`);
 class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
 let role='admin',csv='maintainer,mail,mail_test\n維護甲,new@example.test,';
 const store={prepare(sql){let args=[];return {bind(...v){args=v;return this;},async run(){return d.prepare(sql).run(...args);},async all(){return {results:d.prepare(sql).all(...args)};}};}};
 const module=load('../app/api/manage/route.ts',{
   '@/lib/store.mjs':{getConnection:()=>d},'@/lib/registration.mjs':{RegistrationError:class extends Error{}},'@/lib/registration-mail':{},'node:crypto':{},'@/lib/realtime-settings.mjs':realtimeSettings,'@/lib/passwords.mjs':{},
   '@/lib/server':{db:()=>store,identity:async()=>({role,email:'admin@test'}),writeGuard:req=>{if(req.headers.get('origin')!=='http://test')throw new AppError(403,'origin');},AppError,required:(v,max=160)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new AppError(400,'required');return v.trim();},fail:e=>Response.json({error:e.message},{status:e.status||500})}
 });
 const post=p=>module.POST(new Request('http://test/api/manage',{method:'POST',headers:{origin:'http://test','Content-Type':'application/json'},body:JSON.stringify(p)}));
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(csv);
 try{
   const input={action:'maintainer',name:'維護甲',email:'old@example.test',english_name:'Complete English Name'};
   role='member';assert.equal((await post(input)).status,403);role='admin';
   assert.equal((await post(input)).status,200);
   assert.equal((await post({...input,english_name:'X'.repeat(161)})).status,400);
   assert.equal((await post({action:'maintainerSyncGoogle'})).status,200);
   assert.equal(d.prepare('SELECT english_name FROM maintainers').get().english_name,'Complete English Name');
   assert.equal(d.prepare('SELECT email FROM maintainers').get().email,'new@example.test');
   csv='maintainer,mail,english_name\n維護甲,new@example.test,Updated Full Name';
   assert.equal((await post({action:'maintainerSyncGoogle'})).status,200);
   assert.equal(d.prepare('SELECT english_name FROM maintainers').get().english_name,'Updated Full Name');
   for(const header of ['英文名','英文名稱','英文稱呼','英文姓名','name_en']){
     csv=`maintainer,mail,${header}\n維護甲,new@example.test,Updated Full Name`;
     assert.equal((await post({action:'maintainerSyncGoogle'})).status,200,header);
     assert.equal(d.prepare('SELECT english_name FROM maintainers').get().english_name,'Updated Full Name',header);
   }
   csv='maintainer,英文名,mail,mail_test\n維護甲,Updated Full Name,new@example.test,test@example.test';
   assert.equal((await post({action:'maintainerSyncGoogle'})).status,200);
   assert.equal(d.prepare('SELECT english_name FROM maintainers').get().english_name,'Updated Full Name');
   assert.equal(d.prepare('SELECT email_test FROM maintainers').get().email_test,'test@example.test');
   csv=' Cht_name , Eng_name ,mail,mail_test\n維護甲,New Schema Full Name,new-schema@example.test,test-schema@example.test';
   assert.equal((await post({action:'maintainerSyncGoogle'})).status,200);
   assert.deepEqual({...d.prepare('SELECT name,english_name,email,email_test FROM maintainers').get()},
     {name:'維護甲',english_name:'New Schema Full Name',email:'new-schema@example.test',email_test:'test-schema@example.test'});
   csv='mail_test,MAIL,ENG_NAME,CHT_NAME,maintainer,english_name\ntest@example.test,new@example.test,Updated Full Name,維護甲,錯誤舊姓名,Wrong old name';
   assert.equal((await post({action:'maintainerSyncGoogle'})).status,200);
   assert.equal(d.prepare('SELECT count(*) AS n FROM maintainers').get().n,1);
   assert.equal(d.prepare('SELECT english_name FROM maintainers').get().english_name,'Updated Full Name');
   csv='maintainer,mail,english_name\n維護甲,new@example.test,Changed\n維護乙,b@example.test,'+'X'.repeat(161);
   assert.equal((await post({action:'maintainerSyncGoogle'})).status,400);
   assert.equal(d.prepare('SELECT english_name FROM maintainers').get().english_name,'Updated Full Name');
   assert.equal((await post({...input,english_name:''})).status,200);
   assert.equal(d.prepare('SELECT english_name FROM maintainers').get().english_name,'');
 }finally{globalThis.fetch=oldFetch;d.close();}
});
