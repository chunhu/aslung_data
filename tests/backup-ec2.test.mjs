import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const script=readFileSync(new URL('../scripts/backup_ec2.sh',import.meta.url),'utf8');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
const posix=p=>process.platform==='win32'?p.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase()):p;
test('EC2 backup help and syntax do not contact Docker or stop services',{skip:!existsSync(bash)},()=>{
  for(const args of [['-n','scripts/backup_ec2.sh'],['scripts/backup_ec2.sh','--help']]){
    const r=spawnSync(bash,args,{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
    if(args.includes('--help'))assert.match(r.stdout,/MySQL、S3/);
  }
});
for(const scenario of ['success','database-failure','archive-failure','image-failure','worker-stopped','restart-failure'])test('EC2 backup preserves service state and completion marker: '+scenario,{skip:!existsSync(bash)},async()=>{
  const root=await mkdtemp(join(process.cwd(),'.tools','backup-ec2-'));
  try{
    const project=join(root,'project'),bin=join(root,'bin'),output=join(root,'snapshots');
    await mkdir(join(project,'scripts'),{recursive:true});await mkdir(join(project,'.git'));await mkdir(bin);
    await writeFile(join(project,'scripts','backup_ec2.sh'),script);await writeFile(join(project,'.env'),'TOKEN=private-fixture\n');await writeFile(join(project,'compose.yaml'),'services: {}\n');
    const mocks={
      git:`#!/usr/bin/env bash
shift 2
case "$*" in
 'rev-parse --git-common-dir') echo .git ;;
 'rev-parse HEAD') echo fixture-commit ;;
 'archive --format=tar HEAD') tar -cf - --files-from /dev/null ;;
 *) exit 0 ;;
esac
`,
      flock:'#!/usr/bin/env bash\nexit 0\n',
      docker:`#!/usr/bin/env bash
echo "$*" >> "$BACKUP_TEST_TRACE"
case "$*" in
 'compose --profile calibration ps -a -q app') echo fixture-app ;;
 'compose --profile calibration ps -a -q calibration-worker') echo fixture-worker ;;
 'inspect --format {{.State.Running}} fixture-app') echo true ;;
 'inspect --format {{.State.Running}} fixture-worker') if [[ $BACKUP_TEST_CASE == worker-stopped ]]; then echo false; else echo true; fi ;;
 'start fixture-app') [[ $BACKUP_TEST_CASE != restart-failure ]] ;;
 'inspect --format {{.Image}} '*) echo sha256:fixture ;;
 'exec -i fixture-app '*) cat >/dev/null; echo /app/data/aslung.sqlite ;;
 'image save '*) [[ $BACKUP_TEST_CASE != image-failure ]] || exit 1; tar -cf - --files-from /dev/null ;;
 *'--entrypoint node'*)
   cat > "$BACKUP_TEST_HELPER"
   [[ $BACKUP_TEST_CASE != database-failure ]] || exit 1
   dest='';for arg in "$@"; do if [[ $arg == type=bind,src=*,dst=/backup ]]; then dest=\${arg#type=bind,src=};dest=\${dest%,dst=/backup};fi;done
   printf 'fixture snapshot' > "$dest/aslung.sqlite"
   printf '/app/data/aslung.sqlite\n' > "$dest/database-path.txt"
   ;;
 *'--entrypoint tar'*) [[ $BACKUP_TEST_CASE != archive-failure ]] || exit 1; tar -czf - --files-from /dev/null ;;
 *) exit 0 ;;
esac
`
    };
    for(const [name,contents] of Object.entries(mocks))await writeFile(join(bin,name),contents,{mode:0o755});
    const trace=join(root,'trace.log');await writeFile(trace,'');
    const r=spawnSync(bash,['-c','export PATH="$BACKUP_TEST_BIN:$PATH"; exec bash "$BACKUP_TEST_SCRIPT" --output "$BACKUP_TEST_OUTPUT"'],{encoding:'utf8',timeout:30000,env:{...process.env,BACKUP_TEST_BIN:posix(bin),BACKUP_TEST_SCRIPT:posix(join(project,'scripts','backup_ec2.sh')),BACKUP_TEST_OUTPUT:posix(output),BACKUP_TEST_TRACE:posix(trace),BACKUP_TEST_HELPER:posix(join(root,'helper.txt')),BACKUP_TEST_CASE:scenario,SUDO_UID:'',SUDO_GID:''}});
    assert.ok(existsSync(output),r.stdout+r.stderr);
    const log=await readFile(trace,'utf8'),dest=join(output,(await readdir(output))[0]);
    if(['success','worker-stopped'].includes(scenario)){
      assert.equal(r.status,0,r.stdout+r.stderr);assert.ok(existsSync(join(dest,'COMPLETE')));
      assert.match(await readFile(join(dest,'SHA256SUMS'),'utf8'),/\.env/);
      assert.equal(await readFile(join(dest,'.env'),'utf8'),'TOKEN=private-fixture\n');
    }else {assert.notEqual(r.status,0);assert.equal(existsSync(join(dest,'COMPLETE')),false);}
    if(scenario==='image-failure')assert.doesNotMatch(log,/stop -t/);
    else {
      assert.ok(log.indexOf('stop -t 120 fixture-app')<log.indexOf('run --rm -i --network none'));
      assert.match(log,/--volumes-from fixture-app:ro/);assert.match(log,/start fixture-app/);
      if(scenario==='worker-stopped')assert.doesNotMatch(log,/stop -t 120 fixture-worker|start fixture-worker/);
      else assert.match(log,/start fixture-worker/);
    }
    assert.doesNotMatch(log,/down -v|compose.*up|image.*prune/);
    assert.doesNotMatch(r.stdout,/private-fixture/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('backup helper uses read-only SQLite without migrations and creates an intact standalone copy',async()=>{
  const root=await mkdtemp(join(process.cwd(),'.tools','backup-sqlite-'));
  try{
    const source=join(root,'source.sqlite'),target=join(root,'aslung.sqlite');
    const d=new DatabaseSync(source);d.exec('CREATE TABLE example(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO example VALUES(1,\'preserved\')');d.close();
    const digest=()=>createHash('sha256').update(readFileSync(source)).digest('hex'),before=digest();
    const helper=script.match(/--input-type=module - <<'NODE'\n(import \{DatabaseSync,backup\}[\s\S]*?)\nNODE/)[1];
    assert.doesNotMatch(helper,/store\.mjs|getConnection/);
    const code=helper.replaceAll("'/backup/aslung.sqlite'",JSON.stringify(target)).replaceAll("'/backup/database-path.txt'",JSON.stringify(join(root,'path.txt')));
    const r=spawnSync(process.execPath,['--input-type=module','-'],{input:code,encoding:'utf8',env:{...process.env,BACKUP_DATABASE:source}});
    assert.equal(r.status,0,r.stderr);assert.equal(digest(),before);
    const check=new DatabaseSync(target,{readOnly:true});try{assert.equal(check.prepare('SELECT value FROM example').get().value,'preserved');}finally{check.close();}
  }finally{await rm(root,{recursive:true,force:true});}
});
