// pnpm build first. Disposable local SQLite and synthetic public articles/images only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import {hashPassword,tokenHash} from '../lib/passwords.mjs';
import {ensurePostSchema,savePost} from '../lib/posts.mjs';
const dir=mkdtempSync(join(tmpdir(),'aslung-public-home-http-'));
process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {getConnection}=await import('../lib/store.mjs');const d=getConnection(),cookies={};
const password='Local-Homepage-Test-2026!',hash=await hashPassword(password),admin={email:'admin@test.invalid',name:'平台編輯團隊',role:'admin'};
for(const role of ['admin','basic','member']){const token=randomBytes(32).toString('hex');d.prepare('INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,?,1,?)').run(role+'@test.invalid',role,role,role,role,hash);d.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),role+'@test.invalid',Date.now()+3600000);cookies[role]='aslung_session='+token;}
ensurePostSchema(d);const imageId=randomUUID(),imageSrc='/api/posts/images?id='+imageId,privateImageId=randomUUID();
const image=await sharp({create:{width:480,height:140,channels:3,background:'#5bb994'}}).webp().toBuffer();
for(const id of [imageId,privateImageId])d.prepare('INSERT INTO site_post_images VALUES(?,?,?,?,?)').run(id,image,'image/webp',admin.email,new Date().toISOString());
const content={type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'從觀測資料開始，建立研究的共同語言'}]},{type:'paragraph',content:[{type:'text',text:'這是獨立測試環境的示範文章。PUBLIC_BODY_ONLY_ON_DETAIL',marks:[{type:'bold'}]}]},{type:'image',attrs:{src:imageSrc,alt:'觀測資料流程示意'}}]};
const make=(title,extra={},now='2026-11-01T00:00:00.000Z')=>savePost(d,admin,{kind:'article',title,summary:'整合觀測、校正與研究協作，讓環境資料成為可理解的資訊。',body:'範例文章內文',status:'published',pinned:false,...extra},now);
const featured=make('從環境觀測到研究應用：認識資料平台',{pinned:true,visibility:'public',body_json:content});
make('ASLUNG 與 HOBO：多元觀測資料如何整合',{visibility:'public',summary:'在同一個工作空間理解不同設備的資料來源、期間與使用情境。'});
make('平台新功能：更有條理的內容與檔案共享',{visibility:'public',kind:'news',summary:'透過會員角色、資料夾與授權期限，建立清楚的團隊協作方式。'});
for(let n=0;n<20;n++)make('環境觀測實務分享 '+String(n+1).padStart(2,'0'),{visibility:'public'},'2026-10-01T00:00:00.000Z');
let memberPost=make('NEVER_PRIVATE_ARTICLE',{body:'NEVER_PRIVATE_BODY'}),draft=make('NEVER_DRAFT_PUBLIC',{visibility:'public',status:'draft'}),archived=make('NEVER_ARCHIVED_PUBLIC',{visibility:'public',status:'archived'});
let privateImagePost=make('NEVER_PRIVATE_IMAGE_POST',{body_json:{type:'doc',content:[{type:'image',attrs:{src:'/api/posts/images?id='+privateImageId}}]}});
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,cwd=resolve('.next/standalone');
for(const [target,source] of [['public','public'],['.next/static','.next/static']])if(!existsSync(join(cwd,target)))symlinkSync(resolve(source),join(cwd,target),'dir');
const child=spawn(process.execPath,[join(cwd,'server.js')],{cwd,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
const get=(path,role)=>fetch(origin+path,{headers:role?{Cookie:cookies[role]}:{},redirect:'manual'});
const post=(body,role='admin')=>fetch(origin+'/api/posts',{method:'POST',headers:{Cookie:cookies[role],Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
try{
let ready=false;for(let n=0;n<100;n++){try{if((await get('/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,logs);
let response=await get('/');assert.equal(response.status,200);const home=await response.text();assert.match(home,/public-hero/);assert.ok(home.includes(featured.title));assert.ok(!home.includes('PUBLIC_BODY_ONLY_ON_DETAIL'));
for(const marker of ['NEVER_PRIVATE','NEVER_DRAFT','NEVER_ARCHIVED'])assert.ok(!home.includes(marker),marker);assert.ok(!home.includes('created_by'));
for(const role of ['admin','basic']){response=await get('/',role);assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes('public-hero'));assert.ok(text.includes('workspace-navigation'));assert.equal((await get('/login',role)).status,307);assert.equal((await get('/about',role)).status,200);}
assert.equal((await get('/login')).status,200);response=await get('/?id=AL-HOME');assert.equal(response.status,307);assert.match(response.headers.get('location'),/\/login\?id=AL-HOME/);
const feed=await (await get('/api/posts?public=1')).json();assert.equal(feed.total,23);assert.equal(feed.rows.length,20);assert.equal(feed.rows[0].id,featured.id);assert.equal('created_by' in feed.rows[0],false);assert.equal('version' in feed.rows[0],false);
assert.equal((await (await get('/api/posts?public=1&page=2')).json()).rows.length,3);assert.equal((await (await get('/api/posts?public=1&q=NEVER')).json()).total,0);
assert.equal((await get('/api/posts?public=1&manage=1')).status,400);assert.equal((await get('/api/posts')).status,401);
assert.equal((await get('/articles')).status,200);assert.equal((await get('/articles?page=2')).status,200);
response=await get('/articles/'+featured.id);assert.equal(response.status,200);const detail=await response.text();assert.ok(detail.includes('PUBLIC_BODY_ONLY_ON_DETAIL'));assert.match(detail,/post-rich-content/);assert.match(response.headers.get('cache-control'),/no-store/);
assert.equal((await get('/api/posts?public=1&id='+featured.id)).status,200);assert.equal((await get(imageSrc)).status,200);
for(const row of [memberPost,draft,archived,privateImagePost]){response=await get('/articles/'+row.id);assert.equal(response.status,404);const body=await response.text();assert.ok(!body.includes(row.title));assert.equal((await get('/api/posts?public=1&id='+row.id)).status,404);}
assert.equal((await get('/api/posts/images?id='+privateImageId)).status,401);
assert.equal((await post({...memberPost,pinned:false,visibility:'public'},'basic')).status,403);
let changed=await (await post({...featured,pinned:true,visibility:'members'})).json();assert.equal(changed.visibility,'members');assert.equal((await get('/articles/'+featured.id)).status,404);assert.equal((await get(imageSrc)).status,401);assert.equal((await get(imageSrc,'basic')).status,200);
changed=await (await post({...changed,pinned:true,status:'archived',visibility:'public'})).json();assert.equal((await get(imageSrc,'basic')).status,404);
changed=await (await post({...changed,pinned:true,status:'published'})).json();assert.equal((await get('/articles/'+featured.id)).status,200);assert.equal((await get(imageSrc)).status,200);
// A fresh deployment with no public content has an informative empty state.
const publicIds=d.prepare("SELECT id FROM site_posts WHERE visibility='public'").all().map(row=>row.id);
d.prepare("UPDATE site_posts SET visibility='members' WHERE visibility='public'").run();
const emptyHome=await (await get('/')).text();assert.ok(emptyHome.includes('公開文章即將陸續上線'));assert.equal((await (await get('/api/posts?public=1')).json()).total,0);
for(const id of publicIds)d.prepare("UPDATE site_posts SET visibility='public' WHERE id=?").run(id);
// Admin-only persisted display switches, optimistic writes and actual server markup.
assert.equal((await get('/api/homepage-settings')).status,401);
for(const role of ['basic','member'])assert.equal((await get('/api/homepage-settings',role)).status,403);
let config=await (await get('/api/homepage-settings','admin')).json();const defaults={...config.settings};
assert.equal(defaults.hero_device_label,false);assert.equal(defaults.features,true);assert.equal(defaults.join,true);
const setDisplay=(settings,version=config.version,role='admin',requestOrigin=origin)=>fetch(origin+'/api/homepage-settings',{method:'POST',headers:{Cookie:cookies[role],Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify({settings,version})});
for(const role of ['basic','member'])assert.equal((await setDisplay(defaults,config.version,role)).status,403);
assert.equal((await setDisplay(defaults,config.version,'admin','https://other.invalid')).status,403);
assert.equal((await setDisplay({...defaults,features:'false'})).status,400);
const before=config.version;config=await (await setDisplay({...defaults,features:false,join:false})).json();assert.equal(config.version,before+1);
for(const path of ['/','/about']){const html=await (await get(path)).text();assert.ok(!html.includes('id="features"'));assert.ok(!html.includes('id="join"'));assert.ok(html.includes('public-hero'));assert.ok(html.includes('href="/login"'));}
assert.equal((await setDisplay(defaults,before)).status,409);assert.equal((await (await get('/api/homepage-settings','admin')).json()).settings.features,false);
const hidden=Object.fromEntries(Object.keys(defaults).map(key=>[key,false]));config=await (await setDisplay(hidden)).json();
const hiddenHome=await (await get('/')).text();assert.ok(!hiddenHome.includes(featured.title));assert.ok(!hiddenHome.includes('public-visual'));assert.match(hiddenHome,/public-hero-text-only/);assert.ok(hiddenHome.includes('href="/login"'));
assert.equal((await get('/articles/'+featured.id)).status,200);assert.equal((await get('/register')).status,200);
config=await (await setDisplay({...defaults,hero_device_label:true})).json();assert.ok((await (await get('/')).text()).includes('ASLUNG · LI-COR / HOBO'));
config=await (await setDisplay(defaults)).json();assert.ok(!(await (await get('/')).text()).includes('ASLUNG · LI-COR / HOBO'));
assert.equal((await get('/api/manage?scope=homepage','admin')).status,200);assert.equal((await get('/api/manage?scope=homepage','basic')).status,403);
console.log('PASS: public homepage, authenticated workspace, login/QR links, opt-in migration, metadata-only public feed, pagination/search, private/draft/archive denial, anonymous public images immediate audience changes, admin homepage switches, stale write rejection and hidden markup.');
if(process.argv.includes('--preview')){console.log('PREVIEW '+origin+' admin@test.invalid / '+password);await new Promise(resolve=>process.once('SIGTERM',resolve));}
}catch(error){console.error(logs);throw error;}finally{child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));d.close();rmSync(dir,{recursive:true,force:true});}
