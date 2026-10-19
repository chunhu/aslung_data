import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,rm,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
const source=new URL('../scripts/deploy_cal.sh',import.meta.url);
const posix=path=>process.platform==='win32'?path.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase()):path;

test('calibration deploy script has valid Bash syntax and a side-effect-free help command',{skip:!existsSync(bash)},()=>{
  const syntax=spawnSync(bash,['-n','scripts/deploy_cal.sh'],{encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);
  const help=spawnSync(bash,['scripts/deploy_cal.sh','--help'],{encoding:'utf8'});assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/codex\/calibration-management/);
});

for(const scenario of ['success','dirty','build-failure','backup-failure'])test('calibration deployment ordering and failure handling: '+scenario,{skip:!existsSync(bash)},async()=>{
  const root=await mkdtemp(join(process.cwd(),'.tools','deploy-cal-test-'));
  try{
    const bin=join(root,'bin');await mkdir(bin);await mkdir(join(root,'scripts'));await mkdir(join(root,'lib'));await mkdir(join(root,'.git'));
    await copyFile(source,join(root,'scripts','deploy_cal.sh'));
    await writeFile(join(root,'compose.yaml'),'services: {}\n');await writeFile(join(root,'.env'),'# fixture only\n');
    await writeFile(join(root,'lib','processing-jobs.mjs'),'');await writeFile(join(root,'scripts','calibration-worker.mjs'),'');
    await writeFile(join(root,'scripts','setup-autostart.sh'),'#!/usr/bin/env bash\necho autostart >> "$DEPLOY_TEST_LOG"\n');
    const mocks={
      git:`#!/usr/bin/env bash
if [[ $1 == -c ]]; then shift 2; fi
echo "git $*" >> "$DEPLOY_TEST_LOG"
case "$1 $2" in
 'diff --quiet') [[ $DEPLOY_TEST_CASE != dirty ]] ;;
 'rev-parse --show-toplevel') pwd ;;
 'rev-parse --git-common-dir') echo .git ;;
 'rev-parse HEAD'|'rev-parse origin/codex/calibration-management') echo fixture-commit ;;
 *) exit 0 ;;
esac
`,
      docker:`#!/usr/bin/env bash
echo "docker $*" >> "$DEPLOY_TEST_LOG"
case "$*" in
 *'build app calibration-worker'*) [[ $DEPLOY_TEST_CASE != build-failure ]] ;;
 *'run --rm --no-deps'*) cat >/dev/null; [[ $DEPLOY_TEST_CASE != backup-failure ]] ;;
 *'exec -T calibration-worker'*) cat >/dev/null ;;
 *'ps -q calibration-worker'*) echo fixture-worker ;;
 'inspect '*) echo 'true 0' ;;
 *) exit 0 ;;
esac
`,
      sudo:'#!/usr/bin/env bash\nif [[ $1 == -v ]]; then exit 0; fi\nexec "$@"\n',
      flock:'#!/usr/bin/env bash\nexit 0\n',systemctl:'#!/usr/bin/env bash\nexit 0\n',sleep:'#!/usr/bin/env bash\nexit 0\n'
    };
    for(const [name,contents] of Object.entries(mocks))await writeFile(join(bin,name),contents,{mode:0o755});
    const trace=join(root,'trace.log');await writeFile(trace,'');
    const result=spawnSync(bash,['-c','cd -- "$DEPLOY_TEST_ROOT" && export PATH="$DEPLOY_TEST_BIN:$PATH" && [[ "$(command -v git)" == "$DEPLOY_TEST_BIN/git" ]] && [[ "$(command -v docker)" == "$DEPLOY_TEST_BIN/docker" ]] && exec bash scripts/deploy_cal.sh'],{cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,DEPLOY_TEST_ROOT:posix(root),DEPLOY_TEST_BIN:posix(bin),DEPLOY_TEST_LOG:posix(trace),DEPLOY_TEST_CASE:scenario}});
    const log=await readFile(trace,'utf8');
    if(scenario==='success'){
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.match(log,/git switch codex\/calibration-management/);assert.match(log,/git merge --ff-only origin\/codex\/calibration-management/);
      assert.ok(log.indexOf('build app calibration-worker')<log.indexOf('stop -t 120 calibration-worker'));
      assert.ok(log.indexOf('run --rm --no-deps')<log.indexOf('up -d --no-build --wait'));
      assert.ok(log.indexOf('up -d --no-build --wait')<log.indexOf('up -d --no-build --force-recreate calibration-worker'));
      assert.match(log,/exec -T calibration-worker/);assert.match(result.stdout,/部署完成/);
    }else{
      assert.notEqual(result.status,0);assert.doesNotMatch(log,/up -d/);
      if(scenario==='dirty')assert.doesNotMatch(log,/git fetch|docker/);
      if(scenario==='build-failure')assert.doesNotMatch(log,/stop -t|run --rm/);
      if(scenario==='backup-failure')assert.match(log,/stop -t 120 calibration-worker/);
    }
    assert.doesNotMatch(log,/git reset|git stash|down -v|switch main/);
  }finally{await rm(root,{recursive:true,force:true});}
});
