// Run after pnpm build. Uses a temporary database and the standalone server.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve('.'),dir=mkdtempSync(join(tmpdir(),'aslung-docs-http-'));
process.env.DATABASE_PATH=join(dir,'test.sqlite');
const {getConnection}=await import('../lib/store.mjs');
const d=getConnection();
const roles=['admin','member','viewer','device_manager','calibration_manager'];
const tokens=new Map();
for(const role of roles){
  const email=`${role}@test.invalid`,token=randomUUID();
  d.prepare('INSERT INTO members(email,user_id,name,role,active,password_hash) VALUES(?,?,?,?,1,?)').run(email,randomUUID(),role,role,'unused');
  d.prepare('INSERT INTO api_tokens(id,email,created_at) VALUES(?,?,?)').run(token,email,new Date().toISOString());
  tokens.set(role,token);
}
// Match the public/static copies made by Docker without duplicating assets.
const standalone=join(root,'.next/standalone');
for(const [target,source] of [['public','public'],['.next/static','.next/static']]){
  if(!existsSync(join(standalone,target)))symlinkSync(join(root,source),join(standalone,target),'dir');
}
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[join(standalone,'server.js')],{
  cwd:standalone,env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_ORIGIN:base},stdio:['ignore','pipe','pipe'],
});
let logs='';child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
const request=(path,role)=>fetch(base+path,{headers:role?{Authorization:`Bearer ${tokens.get(role)}`}:{}});
try{
  let ready=false;
  for(let i=0;i<100;i++){try{if((await request('/api/health')).ok){ready=true;break;}}catch{}await delay(100);}
  assert.ok(ready,'Standalone server did not start: '+logs);
  for(const lang of ['ZH','EN'])for(const ext of ['html','md','docx']){
    const path=`/docs/ASLUNG_Website_User_Manual_${lang}.${ext}`;
    const anonymous=await request(path);assert.equal(anonymous.status,401,path);
    for(const role of roles){
      const response=await request(path,role);
      assert.equal(response.status,role==='admin'?200:403,role+' '+path);
      assert.match(response.headers.get('cache-control'),/no-store/);
      if(role==='admin'){
        assert.ok((await response.arrayBuffer()).byteLength>100);
        if(ext==='html')assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN');
      }
    }
    const head=await fetch(base+path,{method:'HEAD'});assert.equal(head.status,401);
  }
  for(const lang of ['ZH','EN'])for(const ext of ['html','md','docx']){
    const path=`/docs/ASLUNG_API_User_Guide_${lang}.${ext}`;
    assert.equal((await request(path,'member')).status,200,path);
  }
  d.prepare("UPDATE members SET role='member' WHERE email='admin@test.invalid'").run();
  assert.equal((await request('/docs/ASLUNG_Website_User_Manual_ZH.html','admin')).status,403);
  console.log('PASS: production standalone manual assets, administrator access, all four restricted roles, anonymous GET/HEAD denial, role downgrade, iframe headers and public API guides.');
}finally{
  child.kill('SIGTERM');if(child.exitCode===null)await new Promise(r=>child.once('exit',r));
  d.close();rmSync(dir,{recursive:true,force:true});
}
