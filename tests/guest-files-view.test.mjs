import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as guestLanguage from '../lib/guest-file-language.mjs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function view(file,states=[],language='zh-TW'){let index=0;const effects=[],updates=new Map();
 const deps={react:{useState:initial=>{const i=index++;return [i<states.length?states[i]:initial,value=>updates.set(i,value)];},useRef:v=>({current:v}),useEffect:f=>effects.push(f)},'react/jsx-runtime':jsx,
 '@/components/useAppLanguage':{default:()=>language},'@/lib/guest-file-language.mjs':guestLanguage,
 '@/components/PublicSite':{PublicHeader:()=>null,PublicFooter:()=>null},'@/components/ui/button':{Button:'button'},'@/components/ui/input':{Input:'input'},'date-fns-tz':{formatInTimeZone:()=> '2026-11-20T00:00',fromZonedTime:v=>new Date(v+'Z')}};
 const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},m,m.exports);return {View:m.exports.default,effects,updates};
}
function find(node,predicate){if(!React.isValidElement(node))return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const found=find(child,predicate);if(found)return found;}return null;}
test('public catalogue offers metadata and application fields without an original download link',()=>{
 const data={total:1,pages:1,rows:[{id:'f',name:'Data.csv',description:'Public description'}]};
 const {View}=view('../components/GuestFilesPublic.tsx',[data,'',1,data.rows[0]]),tree=View({}),html=renderToStaticMarkup(tree);
 assert.match(html,/Public description/);assert.match(html,/申請下載/);for(const name of ['name','email','organization','purpose'])assert.match(html,new RegExp(`name="${name}"`));
 assert.doesNotMatch(html,/download=1|storage_path|external_url/);
 assert.ok(find(tree,n=>n.type==='input'&&n.props.type==='checkbox'&&n.props.required));
});
test('fragment token survives Strict Mode effect replay and never enters the rendered markup',()=>{
 const {View,effects,updates}=view('../components/GuestFilesPublic.tsx'),token='a'.repeat(64);
 const old=globalThis.window;globalThis.window={location:{hash:'#token='+token,pathname:'/file-share'},history:{replaceState:()=>{globalThis.window.location.hash='';}}};
 try{const tree=View({share:true});effects[0]();effects[0]();assert.equal(updates.get(5),token);assert.doesNotMatch(renderToStaticMarkup(tree),new RegExp(token));}
 finally{globalThis.window=old;}
});
test('admin file settings expose opt-in publishing, direct email sharing and all record views',()=>{
 const data={publication:false,requests:{total:1,rows:[]},shares:{total:0,rows:[]},downloads:{total:0,rows:[]}};
 const {View}=view('../components/GuestFilesAdmin.tsx',[data]),tree=View({api:async()=>data,file:{id:'f',name:'Data.csv'},timezone:'Asia/Taipei'}),html=renderToStaticMarkup(tree);
 for(const text of ['公開檔案說明','直接寄送訪客下載連結','下載申請','分享連結','下載紀錄','到期時間','下載次數上限'])assert.match(html,new RegExp(text));
 assert.equal(find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.checked,false);
 assert.match(html,/外部檔案只能限制/);
});


test('English catalogue and application use translated controls while preserving file metadata',()=>{
 const data={total:1,pages:1,rows:[{id:'f',name:'Data.csv',description:'原始檔案說明'}]};
 const {View}=view('../components/GuestFilesPublic.tsx',[data,'',1,data.rows[0]],'en');
 const html=renderToStaticMarkup(View({}));
 for(const text of ['File catalogue','Search file names and descriptions','1 file','Request download','Previous','Next','Organization','Intended use','Get email verification code','I consent'])assert.ok(html.includes(text),text);
 assert.ok(html.includes('原始檔案說明'));assert.match(html,/lang="en"/);
 assert.doesNotMatch(html,/公開檔案清單|搜尋|申請下載|上一頁|下一頁|共 1 個檔案|同意網站/);
});

test('English request verification, guest verification and download states contain no Chinese interface text',()=>{
 const file={id:'f',name:'Data.csv'},data={total:1,pages:1,rows:[file],name:'Data.csv',remaining:2,expires_at:'2026-12-01T00:00:00Z'};
 const cases=[
  {share:false,states:[data,'',1,file,'request-id','','',false,false,'驗證碼不正確。','驗證碼已寄出，請於 10 分鐘內輸入；驗證後才會送交管理員審核。'],expect:['Verify and submit request','Incorrect verification code.','Enter it within 10 minutes']},
  {share:true,states:[null,'',1,null,'','token','',true,false,'','已寄送至 a***@test.org'],expect:['Guest download','Resend verification code','Verify code','Verification code sent to a***@test.org']},
  {share:true,states:[data,'',1,null,'','token','session',true,false,'','Email 驗證完成。'],expect:['Downloads remaining:','Asia/Taipei, UTC+8','Download file','Verify email again','Email verified.']},
  {share:true,states:[],expect:['Open the complete download link from your email.']}
 ];
 for(const c of cases){const {View}=view('../components/GuestFilesPublic.tsx',c.states,'en'),html=renderToStaticMarkup(View({share:c.share}));assert.doesNotMatch(html,/[\u3400-\u9fff]/);for(const text of c.expect)assert.ok(html.includes(text),text);}
});

test('guest messages follow the current language including bilingual service failures and unknown errors',()=>{
 const {guestFileMessage:t}=guestLanguage;
 assert.equal(t('驗證碼不正確。',false),'驗證碼不正確。');
 assert.equal(t('驗證碼不正確。',true),'Incorrect verification code.');
 assert.equal(t('郵件未設定 / Registration email is not configured.',true),'Registration email is not configured.');
 assert.equal(t('Network error',true),'Network error');
 assert.doesNotMatch(t('未預期的問題',true),/[\u3400-\u9fff]/);
 for(const m of ['下載連結無效或已到期。','下載連結已停用、到期或達下載次數上限。','要求過於頻繁，請稍後再試。','請填寫有效的單位。','此檔案已停止公開申請。','驗證信寄送失敗，請稍後再試。'])assert.doesNotMatch(t(m,true),/[\u3400-\u9fff]/);
});
