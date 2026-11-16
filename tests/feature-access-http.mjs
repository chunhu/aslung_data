// Run after pnpm build. Disposable SQLite, no real SMTP/MySQL requests.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {tokenHash} from '../lib/passwords.mjs';
import {saveFeaturePolicy,saveSharedGroup,featureAdminState} from '../lib/feature-access.mjs';
import {ensurePostSchema,savePost} from '../lib/posts.mjs';
import {fileManagementAction} from '../lib/file-access.mjs';
const root=resolve(process.env.ASLUNG_TEST_ROOT||(process.platform==='win32'?'K:/CodexCache/aslung_data/feature-tests':tmpdir()));mkdirSync(root,{recursive:true});
const dir=mkdtempSync(join(root,'feature-http-'));process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {getConnection}=await import('../lib/store.mjs'),d=getConnection(),admin={email:'admin@test.invalid',role:'admin'},cookies={};
for(const [name,role] of [['admin','admin'],['alice','member'],['bob','member'],['basic','basic']]){
 const email=name+'@test.invalid',token=randomBytes(32).toString('hex');
 d.prepare('INSERT INTO members(email,user_id,name,role,active,password_hash) VALUES(?,?,?,?,1,?)').run(email,name,name,role,'not-used');d.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),email,Date.now()+3600000);cookies[name]='aslung_session='+token;
}
d.exec('UPDATE alert_settings SET enabled=0');
const group=saveSharedGroup(d,admin,{action:'groupSave',name:'Project A',emails:['alice@test.invalid']});
const set=(id,p={})=>saveFeaturePolicy(d,admin,{feature:id,mode:'selected',emails:[],group_ids:[],revision:featureAdminState(d,admin).features.find(f=>f.id===id).revision,...p});
set('news',{group_ids:[group.id]});set('files',{group_ids:[group.id]});set('data');set('connection');
d.prepare('INSERT INTO api_tokens VALUES(?,?,?)').run('aslung_feature_test','bob@test.invalid',new Date().toISOString());
ensurePostSchema(d);const make=(kind,visibility='members')=>savePost(d,admin,{kind,title:'Test '+kind,summary:'Summary',body:'Private content',status:'published',pinned:false,visibility});
const news=make('news'),article=make('article'),publicPost=make('article','public'),imageId=randomUUID();
d.prepare('INSERT INTO site_post_images VALUES(?,?,?,?,?)').run(imageId,Buffer.from('fake webp'),'image/webp',admin.email,new Date().toISOString());d.prepare('INSERT INTO site_post_image_refs VALUES(?,?)').run(news.id,imageId);
d.prepare('INSERT INTO files(id,name,size,mime_type,description,uploader_email,storage_path,created_at) VALUES(?,?,?,?,?,?,?,?)').run('file','File.csv',5,'text/csv','Private file',admin.email,'/unused',new Date().toISOString());
fileManagementAction(d,admin,{action:'permissionSave',resource_type:'file',resource_id:'file',subject_type:'group',subject_id:group.id,permissions:{view:true,download:true,manage:false,grant:false}});
const category=fileManagementAction(d,admin,{action:'folderSave',name:'Project files'}).id;
d.prepare('INSERT INTO files(id,name,size,mime_type,description,uploader_email,storage_path,created_at,folder_id) VALUES(?,?,?,?,?,?,?,?,?)').run('second','Other.csv',5,'text/csv','Other category',admin.email,'/unused',new Date().toISOString(),category);
fileManagementAction(d,admin,{action:'permissionSave',resource_type:'folder',resource_id:category,subject_type:'group',subject_id:group.id,permissions:{view:true,download:false,manage:false,grant:false}});
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,cwd=resolve('.next/standalone');for(const [name,source] of [['public','public'],['.next/static','.next/static']])if(!existsSync(join(cwd,name)))symlinkSync(resolve(source),join(cwd,name),'junction');
const child=spawn(process.execPath,[join(cwd,'server.js')],{cwd,windowsHide:true,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
const get=(path,user)=>fetch(origin+path,{headers:user?{Cookie:cookies[user]}:{}});
const post=(path,p,user='admin',requestOrigin=origin)=>fetch(origin+path,{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',Cookie:cookies[user]},body:JSON.stringify(p)});
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await get('/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,logs);
 assert.equal((await get('/api/posts?kind=news','alice')).status,200);assert.equal((await get('/api/posts?kind=news','bob')).status,403);assert.equal((await get('/api/posts?id='+news.id,'bob')).status,403);
 assert.equal((await get('/api/posts/images?id='+imageId,'bob')).status,403);assert.equal((await get('/api/posts/images?id='+imageId,'alice')).status,200);
 assert.equal((await get('/api/posts?id='+article.id,'bob')).status,200);assert.equal((await get('/api/posts?public=1&id='+publicPost.id)).status,200);
 assert.equal((await get('/api/files','alice')).status,200);assert.equal((await get('/api/files','bob')).status,403);
 const allFiles=await (await get('/api/files?folder=all','alice')).json();assert.equal(allFiles.total,2);assert.equal(allFiles.files.find(f=>f.id==='second').folder_name,'Project files');assert.equal(allFiles.files.find(f=>f.id==='second').permissions.download,false);
 assert.equal((await (await get('/api/files?folder=root','alice')).json()).total,1);assert.equal((await (await get('/api/files?folder=all&q=Other','alice')).json()).total,1);
 for(const user of ['alice','bob','basic'])assert.equal((await get('/api/data?aslung_id=unknown&start=2026-11-01T00:00:00Z&end=2026-11-02T00:00:00Z',''+user)).status,403);
 assert.equal((await fetch(origin+'/api/data?aslung_id=unknown&start=2026-11-01T00:00:00Z&end=2026-11-02T00:00:00Z',{headers:{Authorization:'Bearer aslung_feature_test'}})).status,403);
 const bootstrap=await (await get('/api/manage?scope=bootstrap','bob')).json();assert.equal(bootstrap.featureAccess.news,false);assert.equal(bootstrap.featureAccess.articles,true);
 const full=await (await get('/api/manage?scope=full','bob')).json();assert.deepEqual(full.files,[]);assert.deepEqual(full.tokens,[]);assert.deepEqual(full.grantRequests,[]);
 assert.equal((await get('/api/manage?scope=data','bob')).status,403);assert.equal((await post('/api/manage',{action:'tokenCreate'},'bob')).status,403);
 assert.equal((await get('/api/feature-access','bob')).status,403);assert.equal((await post('/api/feature-access',{action:'policySave'},'admin','http://evil')).status,403);
 const state=await (await get('/api/feature-access','admin')).json();assert.equal(state.groups[0].id,group.id);
 assert.equal((await post('/api/feature-access',{action:'groupSave',id:group.id,revision:1,name:'Project A',emails:[]})).status,200);
 assert.equal((await get('/api/posts?kind=news','alice')).status,403);assert.equal((await get('/api/files','alice')).status,403);
 const policy=state.features.find(f=>f.id==='news');assert.equal((await post('/api/feature-access',{action:'policySave',feature:'news',mode:'role',revision:policy.revision,emails:[],group_ids:[]})).status,200);assert.equal((await get('/api/posts?kind=news','bob')).status,200);
 const preview=await (await get('/api/feature-access?preview_email=bob%40test.invalid','admin')).json();assert.equal(preview.preview.files,false);assert.ok(preview.events.length>=6);
 console.log('PASS: live per-member/group API restrictions, private post/image protection, API-token gating, safe bootstrap/full feeds, immediate shared-group revocation, admin recovery, preview/audit and unchanged public content.');
}catch(e){console.error(logs);throw e;}finally{child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));d.close();const clean=resolve(dir);if(!clean.startsWith(root+sep)||clean===root)throw new Error('Unsafe test cleanup');rmSync(clean,{recursive:true,force:true});}
