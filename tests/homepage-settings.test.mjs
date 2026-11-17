import * as postLanguage from '../lib/post-language.mjs';
import * as homepageContent from '../lib/homepage-content.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as options from '../lib/homepage-options.mjs';
import {publicHomepageSettings,getHomepageSettings,saveHomepageSettings} from '../lib/homepage-settings.mjs';
const admin={email:'admin@test',role:'admin'},member={email:'member@test',role:'member'};
function db(){const d=new DatabaseSync(':memory:');d.exec("CREATE TABLE members(email TEXT PRIMARY KEY,role TEXT,active INTEGER);INSERT INTO members VALUES('admin@test','admin',1),('member@test','member',1)");return d;}
test('homepage defaults preserve current layout and keep the removed device label hidden',()=>{const d=db();try{
 assert.deepEqual(publicHomepageSettings(d),options.DEFAULT_HOMEPAGE_SETTINGS);assert.equal(publicHomepageSettings(d).features,true);assert.equal(publicHomepageSettings(d).join,true);assert.equal(publicHomepageSettings(d).hero_device_label,false);
 assert.deepEqual(Object.keys(publicHomepageSettings(d)).sort(),options.HOMEPAGE_OPTIONS.map(option=>option.key).sort());assert.equal('updated_by' in publicHomepageSettings(d),false);
 assert.equal(getHomepageSettings(d,admin).version,1);assert.equal(getHomepageSettings(d,admin).version,1);
}finally{d.close();}});
test('settings are persistent, independent, atomic and version checked',()=>{const d=db();try{
 const current=getHomepageSettings(d,admin),settings={...current.settings,features:false,join:false};
 const saved=saveHomepageSettings(d,admin,{settings,version:current.version});assert.equal(saved.version,2);assert.equal(saved.updated_by,admin.email);assert.deepEqual(publicHomepageSettings(d),settings);
 assert.throws(()=>saveHomepageSettings(d,admin,{settings:current.settings,version:1}),e=>e.status===409);assert.deepEqual(publicHomepageSettings(d),settings);assert.equal(d.isTransaction,false);
 for(const input of [{settings,version:0},{settings,version:'2'},{settings:{...settings,features:0},version:2},{settings:{features:false},version:2},{settings:{...settings,extra:true},version:2}])assert.throws(()=>saveHomepageSettings(d,admin,input),e=>e.status===400);
 assert.deepEqual(publicHomepageSettings(d),settings);assert.equal(d.isTransaction,false);
}finally{d.close();}});
test('live administrator role and active state are required for reading and writing admin settings',()=>{const d=db();try{
 const current=getHomepageSettings(d,admin);assert.throws(()=>getHomepageSettings(d,member),e=>e.status===403);
 assert.throws(()=>saveHomepageSettings(d,{...member,role:'admin'},current),e=>e.status===403);
 d.prepare("UPDATE members SET active=0 WHERE email=?").run(admin.email);assert.throws(()=>saveHomepageSettings(d,admin,current),e=>e.status===403);
 d.prepare("UPDATE members SET active=1,role='member' WHERE email=?").run(admin.email);assert.throws(()=>saveHomepageSettings(d,admin,current),e=>e.status===403);assert.equal(publicHomepageSettings(d).features,true);assert.equal(d.isTransaction,false);
}finally{d.close();}});
test('hidden sections do not render; the introduction and login remain available',()=>{
 const code=ts.transpileModule(readFileSync(new URL('../components/PublicSite.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const deps={'react/jsx-runtime':jsx,'@/components/LanguageSwitcher':{default:()=>null},'@/components/useAppLanguage':{default:()=> 'zh-TW'},'@/lib/post-language.mjs':postLanguage,'@/components/RichPostBody':{default:()=>null},'@/components/HomepageBody':{default:({body})=>React.createElement('p',null,body)},'@/lib/homepage-options.mjs':options,'@/lib/homepage-content.mjs':homepageContent,'lucide-react':Object.fromEntries(['Activity','ArrowRight','Database','ShieldCheck','SlidersHorizontal','FileText','ArrowUpRight','Users','CheckCircle2'].map(key=>[key,()=>null]))};
 const mod={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},mod,mod.exports);
 const allHidden=Object.fromEntries(Object.keys(options.DEFAULT_HOMEPAGE_SETTINGS).map(key=>[key,false]));
 const html=renderToStaticMarkup(React.createElement(mod.exports.LandingPage,{posts:[],settings:allHidden}));
 for(const section of ['public-visual','public-data-strip','id="features"','id="join"','id="public-articles"'])assert.ok(!html.includes(section),section);
 assert.match(html,/public-hero-text-only/);assert.match(html,/讓環境觀測資料/);assert.match(html,/href="\/login"/);assert.ok(!html.includes('ASLUNG · LI-COR / HOBO'));
 const restored=renderToStaticMarkup(React.createElement(mod.exports.LandingPage,{posts:[],settings:{...options.DEFAULT_HOMEPAGE_SETTINGS,hero_device_label:true}}));assert.ok(restored.includes('ASLUNG · LI-COR / HOBO'));assert.ok(restored.includes('id="features"'));assert.ok(restored.includes('id="join"'));
});
