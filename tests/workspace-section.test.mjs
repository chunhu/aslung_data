import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function navigation(t,{hash='',saved=null,blockedStorage=false,strict=false}={}){
  const oldWindow=globalThis.window,storage=new Map(saved===null?[]:[['aslung_section',saved]]),writes=[],replacements=[],listeners=new Set();
  globalThis.window={location:{hash},localStorage:{getItem:key=>{if(blockedStorage)throw Error('blocked');return storage.get(key)||null;},setItem:(key,value)=>{if(blockedStorage)throw Error('blocked');writes.push(value);storage.set(key,value);}},history:{replaceState:(_state,_title,url)=>{replacements.push(url);globalThis.window.location.hash=url;}},addEventListener:(_event,handler)=>listeners.add(handler),removeEventListener:(_event,handler)=>listeners.delete(handler)};
  const states=[],effects=[];let stateIndex=0,effectIndex=0,pending=[],dirty=false,current,initial=true;
  const react={useState:value=>{const i=stateIndex++;if(!(i in states))states[i]=value;return [states[i],value=>{const next=typeof value==='function'?value(states[i]):value;if(next!==states[i]){states[i]=next;dirty=true;}}];},useEffect:(callback,deps)=>{const i=effectIndex++,previous=effects[i];if(!previous||deps.some((value,j)=>value!==previous.deps[j])){effects[i]={callback,deps,cleanup:previous?.cleanup};pending.push(effects[i]);}}};
  const source=readFileSync(new URL('../components/useWorkspaceSection.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.equal(name,'react');return react;},module,module.exports);
  function render(){stateIndex=0;effectIndex=0;current=module.exports.default();}
  function runEffects(replay=false){const jobs=pending;pending=[];for(const effect of jobs){effect.cleanup?.();effect.cleanup=effect.callback();}if(replay)for(const effect of jobs){effect.cleanup?.();effect.cleanup=effect.callback();}}
  function flush(){runEffects(initial&&strict);initial=false;for(let count=0;dirty;count++){assert.ok(count<10,'navigation effects should settle');dirty=false;render();runEffects();}}
  render();t.after(()=>{for(const effect of effects)effect.cleanup?.();globalThis.window=oldWindow;});
  return {flush,writes,replacements,storage,listeners,sections:module.exports.WORKSPACE_SECTIONS,get section(){return current[0];},get ready(){return current[2];},select:section=>current[1](section),hash:hash=>{globalThis.window.location.hash=hash;for(const handler of listeners)handler();}};
}

test('refreshing #hobo restores HOBO before persisting, including Strict Mode effect replay',t=>{
  const nav=navigation(t,{hash:'#hobo',saved:'data',strict:true});assert.equal(nav.section,'data');assert.equal(nav.ready,false);assert.deepEqual(nav.writes,[]);
  nav.flush();assert.equal(nav.section,'hobo');assert.equal(nav.ready,true);assert.deepEqual(nav.writes,['hobo']);assert.deepEqual(nav.replacements,[]);assert.equal(nav.listeners.size,1);
});
test('returning without a hash restores saved HOBO and writes its URL',t=>{
  const nav=navigation(t,{saved:'hobo'});nav.flush();assert.equal(nav.section,'hobo');assert.deepEqual(nav.replacements,['#hobo']);assert.deepEqual(nav.writes,['hobo']);
});
test('URL takes precedence over saved state and navigation/hash changes remain synchronized',t=>{
  const nav=navigation(t,{hash:'#files',saved:'hobo'});nav.flush();assert.equal(nav.section,'files');
  nav.select('hobo');nav.flush();assert.equal(nav.storage.get('aslung_section'),'hobo');assert.equal(globalThis.window.location.hash,'#hobo');
  nav.hash('#articles');nav.flush();assert.equal(nav.section,'articles');assert.equal(nav.storage.get('aslung_section'),'articles');
  nav.hash('#not-a-page');nav.flush();assert.equal(nav.section,'articles');
});
test('invalid saved routes fall back to data',t=>{
  const nav=navigation(t,{hash:'#invalid',saved:'missing'});nav.flush();assert.equal(nav.section,'data');assert.deepEqual(nav.writes,['data']);assert.deepEqual(nav.replacements,['#data']);
});
test('HOBO URL restoration works even if browser storage is unavailable',t=>{
  const nav=navigation(t,{hash:'#hobo',blockedStorage:true,strict:true});assert.doesNotThrow(()=>nav.flush());assert.equal(nav.section,'hobo');
});
test('every sidebar destination, including HOBO, is restorable',t=>{
  const nav=navigation(t);const workspace=readFileSync(new URL('../app/workspace.tsx',import.meta.url),'utf8');
  const menu=workspace.match(/const nav=\[(.*?)\];/s)[1];
  for(const match of menu.matchAll(/id:"([^"]+)"/g))assert.ok(nav.sections.includes(match[1]),match[1]+' must survive reload');
});
