// pnpm build first. Temporary SQLite, image bytes and local server; no production services.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import {hashPassword,tokenHash} from '../lib/passwords.mjs';
const dir=mkdtempSync(join(tmpdir(),'aslung-rich-posts-http-'));
process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {getConnection}=await import('../lib/store.mjs');const d=getConnection(),cookies={};
const password='Local-Editor-Test-2026!',hash=await hashPassword(password);
for(const role of ['admin','member','basic']){const token=randomBytes(32).toString('hex'),email=role+'@test.invalid';d.prepare('INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,?,1,?)').run(email,role,role,role,role,hash);d.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),email,Date.now()+3600000);cookies[role]='aslung_session='+token;}
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,cwd=resolve('.next/standalone');
for(const [target,source] of [['public','public'],['.next/static','.next/static']])if(!existsSync(join(cwd,target)))symlinkSync(resolve(source),join(cwd,target),'dir');
const child=spawn(process.execPath,[join(cwd,'server.js')],{cwd,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
const get=(path,role='admin')=>fetch(origin+path,{headers:role?{Cookie:cookies[role]}:{},redirect:'manual'});
const post=(body,role='admin',requestOrigin=origin)=>fetch(origin+'/api/posts',{method:'POST',headers:{Cookie:cookies[role],Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify(body)});
async function ok(response){const r=await response,body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;}
const picture=await sharp({create:{width:320,height:180,channels:3,background:'#2dd4bf'}}).png().toBuffer();
const upload=(bytes=picture,mime='image/png',role='admin',requestOrigin=origin)=>{const form=new FormData();form.set('file',new Blob([bytes],{type:mime}),'example.png');return fetch(origin+'/api/posts/images',{method:'POST',headers:{Cookie:cookies[role],Origin:requestOrigin},body:form});};
try{
let ready=false;for(let n=0;n<100;n++){try{if((await get('/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,logs);
assert.equal((await upload(picture,'image/png','basic')).status,403);assert.equal((await upload(picture,'image/png','admin','https://other.invalid')).status,403);
assert.equal((await upload(Buffer.from('<svg onload="alert(1)"></svg>'),'image/png')).status,400);
assert.equal((await upload(Buffer.from('<script>alert(1)</script>'),'image/png')).status,400);
const large=await sharp({create:{width:4100,height:4100,channels:3,background:'white'}}).png().toBuffer();assert.equal((await upload(large)).status,400);
const image=await ok(upload());const src=image.src;assert.equal((await get(src,null)).status,401);assert.equal((await get(src,'basic')).status,404);assert.equal((await get(src,'member')).status,404);
const adminImage=await get(src);assert.equal(adminImage.headers.get('content-type'),'image/webp');assert.match(adminImage.headers.get('cache-control'),/no-store/);assert.match(adminImage.headers.get('content-disposition'),/^inline/);assert.equal((await sharp(Buffer.from(await adminImage.arrayBuffer())).metadata()).format,'webp');
const rich={type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Research PM₂.₅',marks:[{type:'bold'}]}]},{type:'paragraph',content:[{type:'text',text:'μg/m³ — <script>literal</script>',marks:[{type:'textStyle',attrs:{fontFamily:'Arial',fontSize:'24px',color:'#008080'}}]}]},{type:'image',attrs:{src,alt:'Test instrument',width:320}}]};
let draft=await ok(post({kind:'article',title:'Image access fixture',summary:'',body:'untrusted summary source',body_json:rich,status:'draft',pinned:false}));
assert.equal((await get('/api/posts?id='+draft.id,'basic')).status,404);assert.equal((await get(src,'basic')).status,404);assert.match(draft.body,/Research PM₂.₅/);assert.ok(!draft.body.includes('untrusted summary'));
draft=await ok(post({...draft,pinned:false,status:'published'}));assert.equal((await get('/api/posts?id='+draft.id,'basic')).status,200);assert.equal((await get(src,'basic')).status,200);
assert.equal((await post({...draft,pinned:false},'basic')).status,403);assert.equal((await post({...draft,pinned:false},'admin','https://other.invalid')).status,403);
assert.equal((await post({...draft,pinned:false,body_json:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'bad',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]}]}})).status,400);
const oldVersion=draft;draft=await ok(post({...draft,pinned:false,status:'archived'}));assert.equal((await get(src,'basic')).status,404);assert.equal((await post({...oldVersion,pinned:false})).status,409);
// Reuse grants access while any published post references the image.
let reused=await ok(post({kind:'news',title:'Image reuse fixture',body:'',body_json:rich,status:'published',pinned:false}));assert.equal((await get(src,'basic')).status,200);
reused=await ok(post({...reused,pinned:false,body_json:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Image removed'}]}]}}));assert.equal((await get(src,'basic')).status,404);
const legacy=await ok(post({kind:'article',title:'Legacy fixture',body:'Plain <b>text</b>\n\nNext paragraph',status:'published',pinned:false}));assert.equal(legacy.body_json,null);assert.equal((await get('/api/posts?id='+legacy.id,'basic')).status,200);
console.log('PASS: rich content, old text, schema validation, search text, draft/publish/archive, image reuse/removal, decoded WebP, active-image rejection, pixel bounds, auth/CSRF and stale edits.');
if(process.argv.includes('--preview')){console.log('PREVIEW '+origin+' admin@test.invalid / '+password);await new Promise(resolve=>process.once('SIGTERM',resolve));}
}finally{child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));d.close();rmSync(dir,{recursive:true,force:true});}
