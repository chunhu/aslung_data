import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as model from '../lib/post-document.mjs';
import {ensurePostSchema,savePost,getPost,listPosts} from '../lib/posts.mjs';
const id='00000000-0000-4000-8000-000000000001',admin={role:'admin',email:'admin@test'},member={role:'basic',email:'basic@test'};
const paragraph=(text,marks)=>({type:'paragraph',content:[{type:'text',text,...(marks?{marks}:{})}]});
const doc=content=>({type:'doc',content});
const input=body_json=>({kind:'article',title:'Rich article',summary:'',body:'ignored client text',body_json,status:'draft',pinned:false});
test('document schema normalizes formatting, tables, links, images and searchable plain text',()=>{
 const result=model.normalizePostDocument(doc([{type:'heading',attrs:{level:2,textAlign:'center'},content:[{type:'text',text:'PM₂.₅',marks:[{type:'bold'},{type:'textStyle',attrs:{fontFamily:'Arial',fontSize:'24px',color:'#008080',onclick:'evil'}}]}]},paragraph('μg/m³'),{type:'image',attrs:{src:'/api/posts/images?id='+id,alt:'Instrument',width:200.4,onerror:'evil'}},{type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',attrs:{colspan:1,rowspan:1},content:[paragraph('Header')]}]}]}]));
 assert.match(result.text,/PM₂.₅/);assert.match(result.text,/Instrument/);assert.deepEqual(result.images,[id]);assert.ok(!result.json.includes('evil'));assert.equal(result.doc.content[2].attrs.width,200);
 assert.equal(model.normalizePostDocument(model.plainPostDocument('One\nTwo\n\nThree')).text,'One\nTwo\nThree');
});
test('untrusted nodes, active URLs, external images, styles, oversized or deeply nested documents are rejected',()=>{
 const invalid=[doc([{type:'script',text:'alert(1)'}]),doc([paragraph('x',[{type:'link',attrs:{href:'javascript:alert(1)'}}])]),doc([paragraph('x',[{type:'link',attrs:{href:'data:text/html,evil'}}])]),doc([paragraph('x',[{type:'textStyle',attrs:{color:'red;background:url(evil)'}}])]),doc([paragraph('x',[{type:'textStyle',attrs:{fontFamily:'evil;display:none'}}])]),doc([{type:'image',attrs:{src:'https://external.invalid/image'}}]),doc([{type:'image',attrs:{src:'data:image/png;base64,abc'}}]),doc([{type:'heading',attrs:{level:999},content:[{type:'text',text:'x'}]}]),doc([paragraph('x'.repeat(60001))]),doc([{type:'table',content:[paragraph('bad')]}]),doc([])];
 let nested=paragraph('x');for(let i=0;i<25;i++)nested={type:'blockquote',content:[nested]};invalid.push(doc([nested]));
 for(const value of invalid)assert.throws(()=>model.normalizePostDocument(value),e=>e.status===400);
 assert.throws(()=>model.normalizePostDocument('x'.repeat(1000001)),e=>e.status===400);
});
test('legacy posts remain plain; rich posts preserve document, search text, image references and optimistic editing',()=>{
 const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON');ensurePostSchema(d);
 const old=savePost(d,admin,{kind:'news',title:'Legacy',body:'<script>literal text</script>',status:'published',pinned:false});assert.equal(old.body_json,null);
 d.prepare('INSERT INTO site_post_images VALUES(?,?,?,?,?)').run(id,Buffer.from('bytes'),'image/webp',admin.email,new Date().toISOString());
 let rich=savePost(d,admin,input(doc([paragraph('Searchable research text'),{type:'image',attrs:{src:'/api/posts/images?id='+id}}])));
 assert.equal(rich.body,'Searchable research text\n[圖片]');assert.ok(rich.body_json);assert.equal(d.prepare('SELECT COUNT(*) n FROM site_post_image_refs').get().n,1);
 assert.equal(listPosts(d,admin,{type:'article',manage:true,q:'research text'}).total,1);assert.equal(listPosts(d,member,{type:'article',q:'research text'}).total,0);
 const prior=rich;rich=savePost(d,admin,{...rich,pinned:false,status:'published'});assert.ok(getPost(d,member,rich.id).body_json);
 assert.throws(()=>savePost(d,admin,{...prior,pinned:false,status:'archived'}),e=>e.status===409);
 assert.throws(()=>savePost(d,admin,{...rich,pinned:false,body_json:doc([{type:'image',attrs:{src:'/api/posts/images?id=00000000-0000-4000-8000-000000000099'}}])}),e=>e.status===400);
 assert.equal(getPost(d,member,rich.id).version,rich.version);assert.equal(d.prepare('SELECT COUNT(*) n FROM site_post_image_refs').get().n,1);
 savePost(d,admin,{...rich,pinned:false,body_json:doc([paragraph('Image removed')])});assert.equal(d.prepare('SELECT COUNT(*) n FROM site_post_image_refs').get().n,0);d.close();
});
test('reader renders rich formatting as safe React nodes without accepting executable content',()=>{
 const code=ts.transpileModule(readFileSync(new URL('../components/RichPostBody.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const mod={exports:{}};new Function('require','module','exports',code)(name=>({react:React,'react/jsx-runtime':jsx,'@/lib/post-document.mjs':model})[name],mod,mod.exports);
 const document=doc([paragraph('<script>text</script>',[{type:'bold'},{type:'link',attrs:{href:'https://example.invalid/read'}}]),{type:'image',attrs:{src:'/api/posts/images?id='+id,alt:'" onerror="alert(1)'}}]);
 const html=renderToStaticMarkup(React.createElement(mod.exports.default,{document}));assert.match(html,/<strong>/);assert.match(html,/noopener noreferrer/);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes(' onerror="alert'));
 assert.match(renderToStaticMarkup(React.createElement(mod.exports.default,{document:doc([paragraph('x',[{type:'link',attrs:{href:'javascript:alert(1)'}}])])})),/文章格式無法顯示/);
});
