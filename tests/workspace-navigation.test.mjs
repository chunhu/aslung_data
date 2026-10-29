import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

function fixture(t,{stored={},blocked=false,context={}}={}){
 const oldWindow=globalThis.window,storage=new Map(Object.entries(stored)),writes=[];
 globalThis.window={localStorage:{getItem:key=>{if(blocked)throw Error('blocked');return storage.get(key)||null;},setItem:(key,value)=>{if(blocked)throw Error('blocked');writes.push([key,value]);storage.set(key,value);}}};
 t.after(()=>{globalThis.window=oldWindow;});
 const slots=[],effects=[];let stateIndex=0,effectIndex=0,pending=[],dirty=false,factory,tree;
 const hooks={...React,useState:initial=>{const i=stateIndex++;if(!slots[i]){const slot={value:typeof initial==='function'?initial():initial};slot.set=value=>{const next=typeof value==='function'?value(slot.value):value;if(!Object.is(next,slot.value)){slot.value=next;dirty=true;}};slots[i]=slot;}return [slots[i].value,slots[i].set];},useEffect:(callback,deps)=>{const i=effectIndex++,previous=effects[i];if(!previous||deps.some((v,j)=>!Object.is(v,previous.deps[j]))){effects[i]={callback,deps};pending.push(effects[i]);}}};
 const ctx={open:true,openMobile:false,isMobile:false,toggleSidebar:()=>{},setOpenMobile:()=>{},...context};
 const tag=({children,...props})=>React.createElement('div',Object.fromEntries(Object.entries(props).filter(([key])=>key.startsWith('aria-')||['id','className','hidden','style'].includes(key))),children);
 const deps={react:hooks,'react/jsx-runtime':jsx,'@/components/ui/sidebar':{SidebarProvider:tag,SidebarMenu:tag,SidebarMenuItem:tag,SidebarMenuButton:tag,useSidebar:()=>ctx},'@/components/ui/button':{Button:tag},'lucide-react':{ChevronDown:()=>null,PanelLeftClose:()=>null,PanelLeftOpen:()=>null}};
 function load(file){const code=ts.transpileModule(readFileSync(new URL('../components/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);return module.exports;}
 deps['@/components/useBrowserPreference']=load('useBrowserPreference.ts');const views=load('WorkspaceNavigation.tsx');
 function render(next=factory){factory=next;stateIndex=0;effectIndex=0;tree=factory();return tree;}
 function flush(strict=false){let jobs=pending;pending=[];for(const e of jobs)e.callback();if(strict)for(const e of jobs)e.callback();for(let n=0;dirty;n++){assert.ok(n<15,'effects should settle');dirty=false;render();jobs=pending;pending=[];for(const e of jobs)e.callback();}return tree;}
 return {views,ctx,storage,writes,render,flush,get tree(){return tree;}};
}
function find(node,predicate){if(!React.isValidElement(node))return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props.children)){const found=find(child,predicate);if(found)return found;}return null;}
const items=['news','articles','files','realtime','data','hobo','devices','locations','labs','maintainers','maintenance','calibration','alerts','members','permissions','connection'].map(id=>({id,name:id,icon:()=>null}));
const group=(tree,id)=>find(tree,node=>node.type==='button'&&node.props['aria-controls']==='menu-group-'+id);

test('navigation groups cover every destination exactly once and hide empty unauthorized groups',t=>{
 const f=fixture(t);f.render(()=>f.views.default({items:items.filter(i=>['news','articles','files','data','realtime','connection'].includes(i.id)),section:'data',account:'member'}));f.flush();
 assert.ok(group(f.tree,'resources'));assert.ok(group(f.tree,'data'));assert.ok(!group(f.tree,'members'));assert.ok(!group(f.tree,'devices'));assert.ok(!group(f.tree,'calibration'));
 const ids=f.views.NAVIGATION_GROUPS.flatMap(g=>g.sections);assert.equal(new Set(ids).size,ids.length);assert.deepEqual([...ids].sort(),items.map(i=>i.id).sort());
});
test('group toggle persists without changing the page and navigation automatically expands the current group',t=>{
 const f=fixture(t),selected=[];let section='data';
 const render=()=>f.views.default({items,section,account:'admin',onSelect:id=>selected.push(id)});f.render(render);f.flush();
 group(f.tree,'data').props.onClick();f.flush();assert.equal(group(f.tree,'data').props['aria-expanded'],false);assert.deepEqual(selected,[]);
 assert.equal(JSON.parse(f.storage.get('aslung_menu_groups:admin')).data,false);
 section='members';f.render(render);f.flush();assert.equal(group(f.tree,'members').props['aria-expanded'],true);
 section='hobo';f.render(render);f.flush();assert.equal(group(f.tree,'data').props['aria-expanded'],true);
});
test('saved collapsed state survives initialization and Strict Mode replay; invalid keys do not enter preferences',t=>{
 const f=fixture(t,{stored:{'aslung_menu_groups:admin':JSON.stringify({resources:false,data:true,integration:false,unknown:true})}});
 f.render(()=>f.views.default({items,section:'hobo',account:'admin',onSelect:()=>{}}));assert.deepEqual(f.writes,[]);f.flush(true);
 assert.equal(group(f.tree,'resources').props['aria-expanded'],false);assert.equal(group(f.tree,'data').props['aria-expanded'],true);
 const value=JSON.parse(f.storage.get('aslung_menu_groups:admin'));assert.equal(value.resources,false);assert.ok(!('unknown' in value));
});
test('desktop visibility restores saved hidden state and persists changes separately for each member',t=>{
 const f=fixture(t,{stored:{'aslung_menu_visible:one':'false','aslung_menu_visible:two':'true'}});let account='one';
 const render=()=>f.views.WorkspaceSidebarProvider({account,children:null});f.render(render);assert.deepEqual(f.writes,[]);f.flush(true);assert.equal(f.tree.props.open,false);
 f.tree.props.onOpenChange(true);f.flush();assert.equal(f.storage.get('aslung_menu_visible:one'),'true');
 account='two';f.render(render);f.flush();assert.equal(f.tree.props.open,true);
 f.tree.props.onOpenChange(false);f.flush();assert.equal(f.storage.get('aslung_menu_visible:two'),'false');assert.equal(f.storage.get('aslung_menu_visible:one'),'true');
});
test('visibility buttons expose hide/show actions for desktop and mobile and mobile navigation closes the drawer',t=>{
 let toggles=0;const closed=[];const f=fixture(t,{context:{toggleSidebar:()=>toggles++,setOpenMobile:value=>closed.push(value)}});
 let button=f.views.SidebarVisibilityButton({});assert.equal(button.props['aria-label'],'隱藏選單');button.props.onClick();assert.equal(toggles,1);
 f.ctx.open=false;button=f.views.SidebarVisibilityButton({});assert.equal(button.props['aria-label'],'顯示選單');assert.equal(button.props['aria-expanded'],false);
 f.ctx.isMobile=true;f.ctx.openMobile=true;button=f.views.SidebarVisibilityButton({isEnglish:true,compact:true});assert.equal(button.props['aria-label'],'Hide menu');button.props.onClick();assert.equal(toggles,2);
 const selected=[];f.render(()=>f.views.default({items,section:'hobo',account:'admin',onSelect:id=>selected.push(id)}));f.flush();
 const active=find(f.tree,node=>node.props['aria-current']==='page');active.props.onClick();assert.deepEqual(selected,['hobo']);assert.deepEqual(closed,[false]);
});
test('invalid or unavailable browser storage does not break the navigation',t=>{
 const f=fixture(t,{blocked:true});f.render(()=>f.views.default({items,section:'calibration',account:'admin',onSelect:()=>{}}));assert.doesNotThrow(()=>f.flush());assert.equal(group(f.tree,'calibration').props['aria-expanded'],true);
 const html=renderToStaticMarkup(f.tree);assert.ok(html.includes('校正與異常通知'));assert.ok(html.includes('aria-expanded="true"'));
});
