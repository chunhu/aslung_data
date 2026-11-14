import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as activityModule from '../lib/activity.mjs';
import {createPasswordWorkQueue} from '../lib/passwords.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureActivitySchema,recordActivity,recordVisit,queryActivity,pruneActivity,limitActivity,VISIT_WINDOW_MS,clientIp} from '../lib/activity.mjs';
import {limitedBody,safeFileHeaders,googleCsvUrl,fetchGoogleCsv} from '../lib/http-security.mjs';
function database(){const d=new DatabaseSync(':memory:');d.exec('CREATE TABLE site_stats(key TEXT PRIMARY KEY,value INTEGER,updated_at TEXT)');ensureActivitySchema(d);return d;}
const now=Date.parse('2026-11-13T03:00:00Z');
test('same IP browsers remain distinct, refreshes share a visit, and inactivity creates a new visit',()=>{
  const d=database();try{
    const visit={path:'/login',visitor:'browser-1',ip:'192.0.2.1'};
    assert.equal(recordVisit(d,visit,now).newVisit,true);assert.equal(recordVisit(d,visit,now+1000).counted,false);
    assert.equal(recordVisit(d,visit,now+5000).newVisit,false);
    assert.equal(recordVisit(d,{...visit,path:'/#data'},now+10000).newVisit,false);
    assert.equal(recordVisit(d,{...visit,visitor:'browser-2'},now+20000).newVisit,true);
    assert.equal(recordVisit(d,visit,now+10000+VISIT_WINDOW_MS).newVisit,true);
    assert.equal(d.prepare("SELECT count FROM activity_daily WHERE kind='stats' AND event='visits'").get().count,3);
    assert.equal(d.prepare("SELECT count FROM activity_daily WHERE kind='stats' AND event='visitors'").get().count,2);
    assert.equal(d.prepare('SELECT value FROM site_stats').get().value,5);
    assert.ok(!JSON.stringify(d.prepare('SELECT * FROM activity_visitors').all()).includes('browser-1'));
    assert.throws(()=>recordVisit(d,{...visit,path:'/reset-password?token=secret'},now));
  }finally{d.close();}
});
test('audit query uses filtered keyset pagination and excludes invalid inputs',()=>{
  const d=database();try{
    for(let i=0;i<120;i++)recordActivity(d,{kind:'auth',event:'login',actor:'member@example.test',outcome:i%2?'success':'failure',ip:'192.0.2.1'},now+i);
    recordActivity(d,{kind:'operation',event:'member.delete',actor:'admin@test',target:'member@test'},now);
    const first=queryActivity(d,{kind:'auth',q:'member'},now),second=queryActivity(d,{kind:'auth',q:'member',before:first.next},now);
    assert.equal(first.rows.length,50);assert.equal(second.rows.length,50);assert.equal(new Set([...first.rows,...second.rows].map(row=>row.id)).size,100);
    assert.equal(queryActivity(d,{q:"' OR 1=1 --"},now).rows.length,0);
    for(const filters of [{before:-1},{kind:'all'},{from:'2026-02-30'},{from:'2025-01-01',to:'2026-11-13'}])assert.throws(()=>queryActivity(d,filters,now));
  }finally{d.close();}
});
test('retention removes old details in bounded batches but preserves daily aggregates',()=>{
  const d=database();try{
    const old=now-91*86400000;for(let n=0;n<1200;n++)recordActivity(d,{kind:'auth',event:'login'},old);
    recordActivity(d,{kind:'auth',event:'login'},now);pruneActivity(d,now);assert.equal(d.prepare('SELECT COUNT(*) n FROM activity_events').get().n,201);
    pruneActivity(d,now);assert.equal(d.prepare('SELECT COUNT(*) n FROM activity_events').get().n,1);
    assert.equal(d.prepare('SELECT SUM(count) n FROM activity_daily').get().n,1201);
  }finally{d.close();}
});
test('rate limits reset per minute, sanitize IPs and never use IP as authentication',()=>{
  const d=database();try{
    limitActivity(d,'test',2,now);limitActivity(d,'test',2,now);assert.throws(()=>limitActivity(d,'test',2,now),error=>error.status===429);
    limitActivity(d,'test',2,now+60000);
    assert.equal(clientIp(new Request('http://test',{headers:{'x-forwarded-for':'192.0.2.1, 127.0.0.1'}}),{trustProxy:true}),'192.0.2.1');
    assert.equal(clientIp(new Request('http://test',{headers:{'x-real-ip':'forged'}}),{trustProxy:true}),'');
  }finally{d.close();}
});
test('active uploaded documents are forced to download with sandbox and nosniff',()=>{
  for(const mime of ['text/html','image/svg+xml','application/xhtml+xml','text/javascript']){
    const headers=safeFileHeaders({name:'test.html',mime_type:mime});assert.match(headers['Content-Disposition'],/^attachment/);assert.equal(headers['Content-Type'],'application/octet-stream');assert.equal(headers['X-Content-Type-Options'],'nosniff');assert.match(headers['Content-Security-Policy'],/sandbox/);
  }
  assert.match(safeFileHeaders({name:'safe.pdf',mime_type:'application/pdf'})['Content-Disposition'],/^inline/);
});
test('actual streaming bytes are bounded even without Content-Length',async()=>{
  await assert.rejects(limitedBody(new Request('http://test',{method:'POST',body:'too large'}),4),error=>error.status===413);
  assert.equal(new TextDecoder().decode(await limitedBody(new Response('safe'),4)),'safe');
});
test('Google sync rejects local targets, credentials, spoofed hosts and unsafe redirects before fetching',async()=>{
  for(const url of ['http://127.0.0.1:8080/','http://169.254.169.254/latest/meta-data/','https://docs.google.com.evil.test/spreadsheets/d/test','https://user:pass@docs.google.com/spreadsheets/d/test','https://docs.google.com:8443/spreadsheets/d/test','https://docs.google.com/not-a-sheet'])assert.throws(()=>googleCsvUrl(url));
  assert.equal(googleCsvUrl('https://docs.google.com/spreadsheets/d/test/edit#gid=12'),'https://docs.google.com/spreadsheets/d/test/export?format=csv&gid=12');
  let calls=0;await assert.rejects(fetchGoogleCsv('https://docs.google.com/spreadsheets/d/test',async(_url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'http://169.254.169.254/'}});}),error=>error.status===502);assert.equal(calls,1);
  const text=await fetchGoogleCsv('https://docs.google.com/spreadsheets/d/test',async()=>new Response('id,name\nA,test'));assert.match(text,/A,test/);
});

test('expensive password work has bounded concurrency and a bounded waiting queue',async()=>{
  const run=createPasswordWorkQueue(2,2);let active=0,peak=0;const release=[];
  const task=async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>release.push(resolve));active--;return true;};
  const jobs=[run(task),run(task),run(task),run(task)];
  await assert.rejects(run(task),error=>error.name==='PasswordCapacityError');assert.equal(peak,2);
  release.shift()();release.shift()();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(peak,2);release.shift()();release.shift()();assert.deepEqual(await Promise.all(jobs),[true,true,true,true]);
});

test('real audit wrapper redacts tokens, ignores arbitrary query IDs and retains actor and outcome',async()=>{
  const d=database(),previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='http://test';
  const code=ts.transpileModule(readFileSync(new URL('../lib/activity-server.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const deps={'./store.mjs':{getConnection:()=>d},'./activity.mjs':activityModule,'./server':{identity:async()=>({email:'admin@test'}),AppError:class extends Error{}}};
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);
  try{
    const secret='aslung_'+ 'f'.repeat(48),request=new Request('http://test/api/manage?id='+secret,{method:'POST',headers:{Origin:'http://test'}});
    module.exports.setActivityAction(request,'tokenDelete',secret);
    await module.exports.auditOperation(request,async()=>Response.json({ok:true}));
    const event=d.prepare('SELECT * FROM activity_events').get();assert.equal(event.target,'');assert.equal(event.actor,'admin@test');assert.equal(event.outcome,'success');assert.ok(!JSON.stringify(event).includes(secret));
    const denied=new Request('http://test/api/manage?id='+secret,{method:'POST',headers:{Origin:'http://other'}});
    await module.exports.auditOperation(denied,async()=>Response.json({error:'denied'},{status:403}));
    const last=d.prepare('SELECT * FROM activity_events ORDER BY id DESC LIMIT 1').get();assert.equal(last.actor,'');assert.equal(last.target,'');assert.equal(last.outcome,'failure');
  }finally{if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;d.close();}
});

test('public homepage, about and article paths count visits without logging query strings or arbitrary routes',()=>{
 const d=database();try{
  const visitor='public-browser',at=Date.now();
  for(const [index,path] of ['/','/about','/articles','/articles/00000000-0000-4000-8000-000000000001'].entries())assert.equal(recordVisit(d,{path,visitor},at+index*5000).counted,true);
  for(const path of ['/articles?token=secret','/articles/00000000-0000-4000-8000-000000000001?secret=abc','/arbitrary'])assert.throws(()=>recordVisit(d,{path,visitor},at+30000));
 }finally{d.close();}
});
