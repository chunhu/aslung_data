// Run after pnpm build. Uses only a disposable database/file; no real SMTP or user data.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,existsSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {tokenHash} from '../lib/passwords.mjs';
import {setGuestPublication,createGuestShare,beginGuestDownload} from '../lib/guest-files.mjs';
const root=resolve(process.env.ASLUNG_TEST_ROOT||(process.platform==='win32'?'K:/CodexCache/aslung_data/guest-tests':tmpdir()));
mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'guest-files-http-'));process.env.DATABASE_PATH=join(dir,'guest.sqlite');
const {getConnection}=await import('../lib/store.mjs'),d=getConnection(),admin={email:'admin@guest-test.invalid',role:'admin'};
d.prepare('INSERT INTO members(email,user_id,name,role,active,password_hash) VALUES(?,?,?,?,1,?)').run(admin.email,'admin','Admin','admin','not-used');
const cookieToken=randomBytes(32).toString('hex');d.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(cookieToken),admin.email,Date.now()+3600000);
d.exec('UPDATE alert_settings SET enabled=0');
const target=join(dir,'data.csv'),bytes='time,value\n2026-11-16,42\n';writeFileSync(target,bytes);
d.prepare('INSERT INTO files(id,name,size,mime_type,description,uploader_email,storage_path,created_at) VALUES(?,?,?,?,?,?,?,?)').run('test-file','Data.csv',Buffer.byteLength(bytes),'text/csv','Safe public description',admin.email,target,new Date().toISOString());
setGuestPublication(d,admin,{file_id:'test-file',enabled:true});
const share=createGuestShare(d,admin,{file_id:'test-file',email:'guest@example.test',name:'Guest',organization:'Institute',purpose:'Research',expires_at:new Date(Date.now()+3600000).toISOString(),max_downloads:1});
const otp=beginGuestDownload(d,share.token); // Isolated SMTP substitute: no production mail is sent.
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,cwd=resolve('.next/standalone');
for(const [name,source] of [['public','public'],['.next/static','.next/static']])if(!existsSync(join(cwd,name)))symlinkSync(resolve(source),join(cwd,name),'junction');
const child=spawn(process.execPath,[join(cwd,'server.js')],{cwd,windowsHide:true,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',s=>logs+=s);child.stderr.on('data',s=>logs+=s);
const get=(path,admin=false)=>fetch(origin+path,{headers:admin?{Cookie:'aslung_session='+cookieToken}:{}});
const post=(p,admin=false,requestOrigin=origin)=>fetch(origin+'/api/guest-files',{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',...(admin?{Cookie:'aslung_session='+cookieToken}:{})},body:JSON.stringify(p)});
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await get('/api/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,logs);
 const catalog=await get('/file-catalog');assert.equal(catalog.status,200);assert.match(await catalog.text(),/公開檔案清單/);
 const landing=await get('/file-share');assert.equal(landing.status,200);assert.equal(landing.headers.get('referrer-policy'),'no-referrer');assert.match(landing.headers.get('x-robots-tag'),/noindex/);
 const publicList=await (await get('/api/guest-files')).json();assert.equal(publicList.total,1);assert.ok(!JSON.stringify(publicList).includes(target));
 assert.equal((await get('/api/guest-files?action=admin')).status,401);assert.equal((await post({action:'verifyDownload',token:share.token,code:otp.code},false,'http://evil')).status,403);
 const verify=await post({action:'verifyDownload',token:share.token,code:otp.code});assert.equal(verify.status,200);const {session}=await verify.json();assert.ok(session);
 const download=await post({action:'download',session});assert.equal(download.status,200);assert.equal(download.headers.get('referrer-policy'),'no-referrer');assert.match(download.headers.get('content-disposition'),/attachment/);assert.equal(await download.text(),bytes);
 assert.equal((await post({action:'download',session})).status,403);
 const report=await (await get('/api/guest-files?action=admin',true)).json();assert.equal(report.downloads.total,1);assert.equal(report.downloads.rows[0].status,'completed');assert.equal(report.downloads.rows[0].bytes,Buffer.byteLength(bytes));assert.equal(report.shares.rows[0].used_downloads,1);
 const csv=await get('/api/guest-files?action=export',true);assert.equal(csv.status,200);assert.match(await csv.text(),/guest@example.test/);
 const audit=JSON.stringify(d.prepare('SELECT * FROM activity_events').all());for(const s of [session,share.token,otp.code])assert.ok(!audit.includes(s),'Secrets must not enter audit logs');
 console.log('PASS: standalone public pages, safe catalogue, real-file download, email verification, enforced quota, tracked bytes, admin-only reports/CSV and secret-free audit.');
}catch(e){console.error(logs);throw e;}finally{
 child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));d.close();
 const clean=resolve(dir);if(!clean.startsWith(root+sep)||clean===root)throw new Error('Unsafe test cleanup target');rmSync(clean,{recursive:true,force:true});
}
