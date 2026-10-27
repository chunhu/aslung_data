import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,copyFile,cp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {spawnSync} from 'node:child_process';

test('Docker runner library copy supports the exact runtime import check without opening a database',async()=>{
 const root=resolve('.');await mkdir(join(root,'.tools'),{recursive:true});
 const fixture=await mkdtemp(join(root,'.tools','docker-runtime-test-'));
 try{
  const dockerfile=await readFile(join(root,'Dockerfile'),'utf8');
  const runner=dockerfile.split(/FROM .* AS runner\r?\n/)[1];assert.ok(runner,'runner stage is required');
  // Recreate only the explicitly copied raw libraries. Dependencies resolve
  // from this project's node_modules; no Docker or production database is used.
  for(const line of runner.split(/\r?\n/)){
   if(!line.startsWith('COPY '))continue;
   const parts=line.split(/\s+/),destination=parts.at(-1);
   if(!/^\.\/lib\/?$/.test(destination))continue;
   const target=join(fixture,'lib');await mkdir(target,{recursive:true});
   for(const source of parts.slice(1,-1).filter(value=>value.startsWith('/app/lib'))){
    if(source==='/app/lib'||source==='/app/lib/')await cp(join(root,'lib'),target,{recursive:true});
    else await copyFile(join(root,source.slice('/app/'.length)),join(target,basename(source)));
   }
  }
  const check=runner.match(/^RUN node --input-type=module -e "([^\r\n]+)"/m)?.[1];assert.ok(check,'runner import check must remain enabled');
  const database=join(fixture,'must-not-open.sqlite');
  const result=spawnSync(process.execPath,['--input-type=module','-e',check],{cwd:fixture,encoding:'utf8',env:{...process.env,DATABASE_PATH:database,NODE_ENV:'production'}});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/runtime dependencies OK/);assert.equal(existsSync(database),false,'module verification must not open a database');
 }finally{
  assert.equal(resolve(fixture,'..'),join(root,'.tools'));
  await rm(fixture,{recursive:true,force:true});
 }
});
