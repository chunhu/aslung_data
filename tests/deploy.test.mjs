import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const bash=process.env.BASH_PATH || (process.platform==='win32'
  ? ['C:/Program Files/Git/bin/bash.exe','C:/Program Files/Git/usr/bin/bash.exe'].find(existsSync) : 'bash');

function deploy({fail='',upToDate=false,force=false}={}) {
  const directory=mkdtempSync(join(tmpdir(),'aslung-deploy-'));
  const scripts=join(directory,'scripts'),bin=join(directory,'bin');
  mkdirSync(scripts);mkdirSync(bin);
  const script=join(scripts,'deploy.sh'),log=join(directory,'commands.log');
  copyFileSync(new URL('../scripts/deploy.sh',import.meta.url),script);
  writeFileSync(join(bin,'git'),`#!/bin/bash
printf 'git %s\\n' "$*" >> "$DEPLOY_TEST_LOG"
if [[ "$1" == fetch && "$DEPLOY_FAIL" == fetch ]]; then exit 17; fi
if [[ "$1" == pull && "$DEPLOY_FAIL" == pull ]]; then exit 18; fi
if [[ "$1" == rev-parse ]]; then
  if [[ "$2" == HEAD || "$DEPLOY_UP_TO_DATE" == 1 ]]; then echo old; else echo new; fi
fi
`,{mode:0o755});
  writeFileSync(join(bin,'sudo'),'#!/bin/bash\nexec "$@"\n',{mode:0o755});
  writeFileSync(join(bin,'docker'),`#!/bin/bash
printf 'docker %s\\n' "$*" >> "$DEPLOY_TEST_LOG"
if [[ "$*" == *" build "* && "$DEPLOY_FAIL" == build ]]; then exit 19; fi
if [[ "$*" == *" up "* && "$DEPLOY_FAIL" == health ]]; then exit 23; fi
`,{mode:0o755});
  try {
    // Convert Windows drive paths before using ':' as the POSIX PATH separator.
    const result=spawnSync(bash,['-c','if command -v cygpath >/dev/null 2>&1; then DEPLOY_TEST_BIN=$(cygpath -u "$DEPLOY_TEST_BIN"); fi; export PATH="$DEPLOY_TEST_BIN:$PATH"; exec bash "$DEPLOY_TEST_SCRIPT" '+(force?'--force':'')],{
      cwd:directory,encoding:'utf8',timeout:15000,
      env:{...process.env,DEPLOY_TEST_BIN:bin.replaceAll('\\','/'),DEPLOY_TEST_SCRIPT:script.replaceAll('\\','/'),
        DEPLOY_TEST_LOG:log.replaceAll('\\','/'),DEPLOY_FAIL:fail,DEPLOY_UP_TO_DATE:upToDate?'1':'0'}
    });
    assert.ifError(result.error);
    return {status:result.status,output:result.stdout+result.stderr,commands:existsSync(log)?readFileSync(log,'utf8'):''};
  }finally{
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
    assert.ok(directory.includes('aslung-deploy-'));
    rmSync(directory,{recursive:true,force:true});
  }
}

test('deployment builds before replacing the container, waits for health, and reports each stage',{skip:!bash},()=>{
  const result=deploy();assert.equal(result.status,0,result.output);
  assert.match(result.commands,/git pull --ff-only origin main/);
  const build=result.commands.indexOf('docker compose --progress plain build app');
  const start=result.commands.indexOf('docker compose up -d --no-build --wait --wait-timeout 180 app');
  assert.ok(build>=0&&start>build,result.commands);
  assert.match(result.output,/部署完成，服務健康檢查通過/);
  for(const stage of ['檢查 GitHub 更新','更新程式碼','Docker 映像建置','容器更新與健康檢查'])
    assert.ok(result.output.includes(`[階段耗時] ${stage}：`));
});

for(const [stage,code] of [['fetch',17],['pull',18],['build',19],['health',23]]) {
  test(`deployment stops and reports failure when ${stage} fails`,{skip:!bash},()=>{
    const result=deploy({fail:stage});assert.equal(result.status,code,result.output);
    assert.match(result.output,/部署失敗/);assert.doesNotMatch(result.output,/--- 部署完成/);
    if(stage!=='health')assert.doesNotMatch(result.commands,/docker compose up/);
    if(stage==='fetch'||stage==='pull')assert.doesNotMatch(result.commands,/docker compose --progress plain build/);
  });
}

test('unchanged checkout skips a noninteractive deployment unless --force is supplied',{skip:!bash},()=>{
  const skipped=deploy({upToDate:true});assert.equal(skipped.status,0,skipped.output);
  assert.doesNotMatch(skipped.commands,/docker /);
  const forced=deploy({upToDate:true,force:true});assert.equal(forced.status,0,forced.output);
  assert.match(forced.commands,/docker compose --progress plain build app/);
});

test('runner library copies support the real backup CLI after registration migration',()=>{
  const directory=mkdtempSync(join(tmpdir(),'aslung-runner-'));
  mkdirSync(join(directory,'lib'));mkdirSync(join(directory,'scripts'));
  const dockerfile=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
  try {
    for(const match of dockerfile.matchAll(/\/app\/(lib\/[\w.-]+\.mjs)/g))
      copyFileSync(new URL('../'+match[1],import.meta.url),join(directory,match[1]));
    copyFileSync(new URL('../scripts/backup.mjs',import.meta.url),join(directory,'scripts','backup.mjs'));
    const result=spawnSync(process.execPath,[join(directory,'scripts','backup.mjs')],{
      cwd:directory,encoding:'utf8',timeout:15000,
      env:{...process.env,DATABASE_PATH:join(directory,'data.sqlite'),BACKUP_PATH:join(directory,'backups')}
    });
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/備份完成/);
    assert.equal(readdirSync(join(directory,'backups')).filter(file=>file.endsWith('.sqlite')).length,1);
  }finally{
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
    assert.ok(directory.includes('aslung-runner-'));
    rmSync(directory,{recursive:true,force:true});
  }
});
