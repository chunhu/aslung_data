import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {cloneHomepageContent,normalizeHomepageContent,normalizeHomepageRich,validHomepageContent} from '../lib/homepage-content.mjs';
import {getHomepageSettings,saveHomepageSettings,publicHomepageContent,isPublicHomepageImage} from '../lib/homepage-settings.mjs';
const admin={email:'admin@test'},image=randomUUID();
function fixture(){const d=new DatabaseSync(':memory:');d.exec("PRAGMA foreign_keys=ON;CREATE TABLE members(email TEXT PRIMARY KEY,role TEXT,active INTEGER);INSERT INTO members VALUES('admin@test','admin',1),('member@test','member',1)");const state=getHomepageSettings(d,admin);d.prepare('INSERT INTO site_post_images VALUES(?,?,?,?,?)').run(image,Buffer.from('fake'),'image/webp',admin.email,new Date().toISOString());return {d,state};}
const paragraph=(text,marks)=>({type:'paragraph',content:[{type:'text',text,...(marks?{marks}:{})}]});
const doc=(...children)=>JSON.stringify({type:'doc',content:children});
const richImage=id=>({type:'image',attrs:{src:'/api/posts/images?id='+id,alt:'Instrument'}});
test('plain legacy fields remain intact and formatted fields persist canonical JSON and derived text per language',()=>{
 const {d,state}=fixture();try{
  const c=cloneHomepageContent();for(const s of Object.values(c))for(const lang of ['zh','en'])delete s[lang].rich;
  c.features.zh.card_0_body='舊內容';assert.equal(validHomepageContent(c),true);
  const migrated=saveHomepageSettings(d,admin,{...state,content:c});assert.equal(migrated.content.features.zh.card_0_body,'舊內容');assert.deepEqual(migrated.content.features.zh.rich,{});
  c.features.zh.rich={card_0_body:doc(paragraph('校正資料',[{type:'bold'},{type:'textStyle',attrs:{color:'#123456',fontSize:'20px',onclick:'evil'}}]),richImage(image))};c.features.en.rich={card_0_body:doc(paragraph('Independent English'))};
  const saved=saveHomepageSettings(d,admin,{...migrated,content:c});assert.match(saved.content.features.zh.card_0_body,/校正資料/);assert.ok(saved.content.features.zh.rich.card_0_body.includes('bold'));assert.ok(!saved.content.features.zh.rich.card_0_body.includes('evil'));assert.equal(saved.content.features.en.card_0_body,'Independent English');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM homepage_image_refs').get().n,1);assert.equal(isPublicHomepageImage(d,image),true);
  assert.equal(getHomepageSettings(d,admin).content.features.zh.rich.card_0_body,saved.content.features.zh.rich.card_0_body);
 }finally{d.close();}
});
test('homepage images stay private until saved; hiding, resetting and stale edits preserve correct publication state',()=>{
 const {d,state}=fixture();try{
  assert.equal(isPublicHomepageImage(d,image),false);const c=cloneHomepageContent();c.features.zh.rich={description:doc(richImage(image))};
  const saved=saveHomepageSettings(d,admin,{...state,content:c});assert.equal(isPublicHomepageImage(d,image),true);
  const hidden=saveHomepageSettings(d,admin,{...saved,settings:{...saved.settings,features:false}});assert.equal(isPublicHomepageImage(d,image),false);assert.ok(!JSON.stringify(publicHomepageContent(d)).includes(image));
  assert.throws(()=>saveHomepageSettings(d,admin,{...saved,settings:saved.settings}),e=>e.status===409);assert.equal(isPublicHomepageImage(d,image),false);
  const reset=saveHomepageSettings(d,admin,{...hidden,content:cloneHomepageContent()});assert.equal(isPublicHomepageImage(d,image),false);assert.equal(d.prepare('SELECT COUNT(*) n FROM homepage_image_refs').get().n,0);assert.deepEqual(reset.content.features.zh.rich,{});
 }finally{d.close();}
});
test('invalid documents, active links, external images, plain-only rich fields and excessive text are rejected',()=>{
 const {d,state}=fixture();try{
  const bad=[doc({type:'script',content:[]}),doc(paragraph('x',[{type:'link',attrs:{href:'javascript:alert(1)'}}])),doc({type:'image',attrs:{src:'https://external.test/a.png'}}),doc(paragraph('x'.repeat(2001))),'{broken'];
  for(const value of bad){const c=cloneHomepageContent();c.features.zh.rich={description:value};assert.equal(validHomepageContent(c),false);assert.throws(()=>saveHomepageSettings(d,admin,{...state,content:c}),e=>e.status===400);}
  const plainOnly=cloneHomepageContent();plainOnly.features.zh.rich={title:doc(paragraph('Not allowed'))};assert.equal(validHomepageContent(plainOnly),false);
  const missing=cloneHomepageContent();missing.features.zh.rich={description:doc(richImage(randomUUID()))};assert.throws(()=>saveHomepageSettings(d,admin,{...state,content:missing}),e=>e.status===400);
  assert.equal(getHomepageSettings(d,admin).version,state.version);assert.equal(d.prepare('SELECT COUNT(*) n FROM homepage_image_refs').get().n,0);assert.equal(d.isTransaction,false);
 }finally{d.close();}
});
test('empty optional rich paragraphs clear the field and recovery drops invalid stored formatting safely',()=>{
 const empty=doc({type:'paragraph'});assert.equal(normalizeHomepageRich(empty).json,null);const c=cloneHomepageContent();c.intro.zh.rich={description:empty};assert.equal(validHomepageContent(c),true);const clean=normalizeHomepageContent(c);assert.equal(clean.intro.zh.description,'');assert.deepEqual(clean.intro.zh.rich,{});
 c.intro.zh.description='Safe text';c.intro.zh.rich.description=doc(paragraph('bad',[{type:'link',attrs:{href:'javascript:evil'}}]));assert.equal(normalizeHomepageContent(c).intro.zh.description,'Safe text');assert.deepEqual(normalizeHomepageContent(c).intro.zh.rich,{});
});
test('only live administrators can publish homepage images or rich content',()=>{
 const {d,state}=fixture();try{
  const c=cloneHomepageContent();c.intro.zh.rich={description:doc(richImage(image))};
  assert.throws(()=>saveHomepageSettings(d,{email:'member@test',role:'admin'},{...state,content:c}),e=>e.status===403);assert.equal(isPublicHomepageImage(d,image),false);
  d.exec("UPDATE members SET active=0 WHERE email='admin@test'");assert.throws(()=>saveHomepageSettings(d,admin,{...state,content:c}),e=>e.status===403);
 }finally{d.close();}
});
