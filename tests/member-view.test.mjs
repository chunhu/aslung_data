import {roleLabel} from '../lib/permissions.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

// Render the actual workspace branch, so accidentally removing or nesting it
// under another section fails without requiring a real account or database.
const source=readFileSync(new URL('../app/workspace.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('workspace.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let expression;
function visit(node){
  if(ts.isJsxExpression(node)&&node.expression&&node.expression.getText(ast).startsWith('section==="members"&&'))expression=node.expression.getText(ast);
  ts.forEachChild(node,visit);
}
visit(ast);
assert.ok(expression,'Workspace must render a members section');
const names=['roleLabel','setAccessMember','section','admin','members','state','alertSettings','busy','isEn','selectedMembers','setModal','setGrantEmail','setGrantType','setGrantLab','setGrantDevice','setGrantId','setEditMember','setConfirmation','setSelectedMembers','mutate','localTime','RegistrationReviews','Button','Table','TableHeader','TableRow','TableHead','TableBody','TableCell','Plus','Trash2','Pencil'];
const compiled=ts.transpileModule(`export default function View({${names.join(',')}}:any){return (${expression});}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const module={exports:{}};
new Function('require','module','exports',compiled)(name=>{assert.equal(name,'react/jsx-runtime');return jsx;},module,module.exports);
const View=module.exports.default;
const tag=name=>({children,title,disabled})=>React.createElement(name,{title,disabled},children);
const fixtures=[{email:'admin@example.test',name:'管理員甲',role:'admin',active:1},
  {email:'member@example.test',name:'會員乙',nickname:'tester',role:'member',active:1,login_count:3}];
function render(overrides={}){
  const props=Object.fromEntries(names.map(name=>[name,()=>{}]));
  Object.assign(props,{section:'members',admin:true,members:fixtures,state:{me:fixtures[0]},alertSettings:{},busy:false,isEn:false,selectedMembers:new Set(),
    roleLabel,localTime:value=>value,RegistrationReviews:()=>React.createElement('section',{},'會員註冊申請'),Button:tag('button'),
    Table:tag('table'),TableHeader:tag('thead'),TableRow:tag('tr'),TableHead:tag('th'),TableBody:tag('tbody'),TableCell:tag('td'),
    Plus:()=>null,Trash2:()=>null,Pencil:()=>null,...overrides});
  return renderToStaticMarkup(React.createElement(View,props));
}

test('members page renders accounts, registration review and account actions',()=>{
  const html=render();
  for(const text of ['會員註冊申請','會員帳號','新增會員','管理員甲','會員乙','tester','member@example.test','角色與權限','停用','刪除會員','告警收信','接收'])assert.ok(html.includes(text),text);
  assert.equal((html.match(/title="刪除會員"/g)||[]).length,1); // Self deletion remains unavailable.
});

test('member management is not rendered for members or other workspace pages',()=>{
  assert.equal(render({admin:false}),'');
  assert.equal(render({section:'devices'}),'');
});
