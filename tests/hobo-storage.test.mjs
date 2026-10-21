import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {ensureHoboSchema,saveHoboLogger,queueHoboSync,runHoboSync,hoboRevision,hoboStatus,withHoboLock,HoboError} from '../lib/hobo.mjs';
import {archiveNextHoboDay,queryStoredHobo,storedHoboCsvStream,readHoboArchive,hoboObjectVersions,purgeHoboScope,hoboStorageConfiguration,hoboDayRange} from '../lib/hobo-storage.mjs';
import {previewHoboCleanup,confirmHoboCleanup,runHoboCleanup,hoboCleanupStatus} from '../lib/hobo-cleanup.mjs';
const serial='20720755',start='2026-10-01T00:00:00.000Z',end='2026-10-01T00:00:01.000Z';
const configuration={mode:'s3',bucket:'aslung-calibration-prod-20261020',region:'ap-northeast-1'};
const row=(timestamp=start,value=0)=>({logger_sn:serial,sensor_sn:'sensor1',timestamp,data_type:'CURRENT',data_type_id:'1',value,unit:'°C',sensor_measurement_type:'Temperature'});
function database(){const d=new DatabaseSync(':memory:');ensureHoboSchema(d);saveHoboLogger(d,{serial,name:'test',start,enabled:false});return d;}
async function seed(d,rows=[row()]){queueHoboSync(d,{serial,start,end});await runHoboSync(d,async()=>rows);}
class FakeS3{
  objects=new Map();calls=[];failHead=false;badHead=false;failDelete=false;badDigest=false;
  async send(command){
    const name=command.constructor.name,input=command.input;this.calls.push({name,input});
    if(name==='PutObjectCommand'){this.objects.set(input.Key,{buffer:Buffer.from(input.Body),checksum:input.ChecksumSHA256,metadata:input.Metadata});return {};}
    if(name==='HeadObjectCommand'){
      if(this.failHead)throw Object.assign(new Error('denied'),{name:'AccessDenied'});
      const object=this.objects.get(input.Key);return {ContentLength:object.buffer.length,ChecksumSHA256:this.badHead?'invalid':object.checksum,Metadata:object.metadata};
    }
    if(name==='GetObjectCommand'){
      const object=this.objects.get(input.Key);assert.ok(object,input.Key);
      return {Body:Readable.from([this.badDigest?Buffer.from('broken'):object.buffer])};
    }
    if(name==='GetBucketVersioningCommand')return {Status:'Enabled'};
    if(name==='ListObjectVersionsCommand')return {Versions:[...this.objects.entries()].filter(([key])=>key.startsWith(input.Prefix)).map(([Key,object])=>({Key,VersionId:'v1',Size:object.buffer.length})),DeleteMarkers:[],IsTruncated:false};
    if(name==='DeleteObjectsCommand'){
      if(this.failDelete)return {Errors:[{Code:'AccessDenied'}]};
      for(const item of input.Delete.Objects){assert.equal(item.VersionId,'v1');this.objects.delete(item.Key);}return {};
    }
    assert.fail(name);
  }
}

test('S3 upload is verified before removing staging; queries and CSV restore data without repopulating SQLite',async()=>{
  const d=database(),client=new FakeS3();await seed(d,[row(start,-2),row(end,0)]);
  const options={configuration,clientFor:()=>client};const result=await archiveNextHoboDay(d,options);
  assert.equal(result.count,2);assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,0);
  const manifest=d.prepare('SELECT * FROM hobo_archives').get();assert.match(manifest.key,/^hobo\/20720755\/2026\/10\/01\/[0-9a-f-]{36}\/[a-f0-9]{64}\.jsonl\.gz$/);
  const put=client.calls.find(c=>c.name==='PutObjectCommand').input;assert.equal(put.ServerSideEncryption,'AES256');assert.equal(put.Bucket,configuration.bucket);
  assert.deepEqual((await queryStoredHobo(d,{serial,start,end},options)).rows.map(r=>r.value),[-2,0]);
  const csv=await new Response(await storedHoboCsvStream(d,{serial,start,end},options)).text();assert.match(csv,/-2/);assert.match(csv,/°C/);assert.equal(csv.trim().split('\r\n').length,3);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,0);assert.equal(hoboStatus(d).loggers[0].archived,2);d.close();
});

test('failed verification keeps local data and tracks orphan scope; retry publishes only verified generation',async()=>{
  const d=database(),client=new FakeS3();await seed(d);client.badHead=true;
  const options={configuration,clientFor:()=>client};await assert.rejects(archiveNextHoboDay(d,options),/驗證失敗/);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,1);assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_archives').get().n,0);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_archive_scopes').get().n,1);
  client.badHead=false;await archiveNextHoboDay(d,options);assert.equal(client.objects.size,2);assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,0);d.close();
});

test('staged corrections override S3 values and new daily archive preserves other observations',async()=>{
  const d=database(),client=new FakeS3(),options={configuration,clientFor:()=>client};await seed(d,[row(start,1),row(end,2)]);await archiveNextHoboDay(d,options);
  await seed(d,[row(start,9)]);
  assert.deepEqual((await queryStoredHobo(d,{serial,start,end},options)).rows.map(r=>r.value),[9,2]);
  await archiveNextHoboDay(d,options);assert.deepEqual((await queryStoredHobo(d,{serial,start,end},options)).rows.map(r=>r.value),[9,2]);
  client.badDigest=true;await assert.rejects(readHoboArchive(d.prepare('SELECT * FROM hobo_archives').get(),client),/大小|檢查碼/);d.close();
});

test('a download in flight cannot return an archived generation after cleanup completes',async()=>{
  const d=database(),client=new FakeS3(),options={configuration,clientFor:()=>client};await seed(d);await archiveNextHoboDay(d,options);
  const send=client.send.bind(client);
  client.send=async command=>{
    const result=await send(command);
    if(command.constructor.name==='GetObjectCommand'){
      d.prepare('DELETE FROM hobo_archives').run();hoboRevision(d,serial);
    }
    return result;
  };
  await assert.rejects(queryStoredHobo(d,{serial,start,end},options),/已更新或清除/);d.close();
});

test('Taiwan day boundary is preserved and pagination spans archives and staged rows',async()=>{
  const d=database(),client=new FakeS3(),options={configuration,clientFor:()=>client};
  // Insert through bound SQL to cover a broader historical interval than the seed job.
  const insert=d.prepare('INSERT INTO hobo_observations VALUES(?,?,?,?,?,?,?,?)');
  for(let i=0;i<230;i++){const r=row(new Date(Date.parse('2026-10-01T15:59:00Z')+i*1000).toISOString(),i);insert.run(...['logger_sn','sensor_sn','timestamp','data_type','data_type_id','value','unit','sensor_measurement_type'].map(key=>r[key]));}
  await archiveNextHoboDay(d,options);assert.equal(d.prepare('SELECT day FROM hobo_archives').get().day,'2026-10-01');
  const range={serial,start:'2026-10-01T15:59:00Z',end:'2026-10-01T16:03:00Z'};
  const page1=await queryStoredHobo(d,range,options),page2=await queryStoredHobo(d,{...range,after:page1.next},options);
  assert.equal(page1.rows.length,200);assert.equal(page2.rows.length,30);assert.equal(page2.next,null);
  assert.equal(new Set([...page1.rows,...page2.rows].map(r=>r.timestamp)).size,230);d.close();
});

test('preview and confirmation reject wrong actors, missing DELETE, stale data and running operations',async()=>{
  const d=database();await seed(d);const filters={serial,from:'2026-10-01',to:'2026-10-01'};
  const plan=previewHoboCleanup(d,filters,'admin');const fakeBackup=async()=>'/fake/backup.sqlite';
  await assert.rejects(confirmHoboCleanup(d,{id:plan.id,actor:'other',confirmation:'DELETE'},fakeBackup),/過期/);
  await assert.rejects(confirmHoboCleanup(d,{id:plan.id,actor:'admin',confirmation:''},fakeBackup),/DELETE/);
  hoboRevision(d,serial);await assert.rejects(confirmHoboCleanup(d,{id:plan.id,actor:'admin',confirmation:'DELETE'},fakeBackup),/變更/);
  const fresh=previewHoboCleanup(d,filters,'admin');await withHoboLock(d,async()=>{
    await assert.rejects(confirmHoboCleanup(d,{id:fresh.id,actor:'admin',confirmation:'DELETE'},fakeBackup),/正在執行/);
  });
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,1);d.close();
});

test('cleanup pauses schedules, blocks regeneration, keeps index/local data on partial S3 failure and safely retries all generations',async()=>{
  const d=database(),client=new FakeS3(),options={configuration,clientFor:()=>client};await seed(d);await archiveNextHoboDay(d,options);await seed(d,[row(start,3)]);await archiveNextHoboDay(d,options);await seed(d,[row(start,4)]);
  saveHoboLogger(d,{serial,name:'test',start,enabled:true});queueHoboSync(d,{serial,start,end});
  const plan=previewHoboCleanup(d,{serial,from:'2026-10-01',to:'2026-10-01'},'admin');assert.equal(plan.local,1);assert.equal(plan.archived,1);assert.equal(plan.scopes,1);
  let backedUp=false;await confirmHoboCleanup(d,{id:plan.id,actor:'admin',confirmation:'DELETE'},async()=>{backedUp=true;return 'test.sqlite';});assert.ok(backedUp);
  assert.equal(d.prepare('SELECT enabled FROM hobo_loggers').get().enabled,0);
  assert.throws(()=>queueHoboSync(d,{serial,start,end}),/清除/);assert.throws(()=>saveHoboLogger(d,{serial,name:'x',start,enabled:true}),/清除/);
  await assert.rejects(queryStoredHobo(d,{serial,start,end},options),/正在清除/);
  client.failDelete=true;const purge=(scope,unused,heartbeat)=>purgeHoboScope(scope,client,heartbeat);
  const failed=await runHoboCleanup(d,{purge,now:Date.now()});assert.equal(failed.status,'RETRY');
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_archives').get().n,1);assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,1);
  client.failDelete=false;await runHoboCleanup(d,{purge,now:Date.now()+120000});
  assert.equal(client.objects.size,0);assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_archives').get().n,0);assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_observations').get().n,0);
  assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_jobs').get().n,0);assert.equal(d.prepare('SELECT COUNT(*) n FROM hobo_loggers').get().n,1);assert.equal(hoboCleanupStatus(d).plans[0].status,'DONE');d.close();
});

test('local-only cleanup removes exactly the selected Taiwan day and preserves other data',async()=>{
  const d=database();await seed(d,[row(start,1)]);
  const r=row('2026-10-01T16:00:00Z',2);d.prepare('INSERT INTO hobo_observations VALUES(?,?,?,?,?,?,?,?)').run(...['logger_sn','sensor_sn','timestamp','data_type','data_type_id','value','unit','sensor_measurement_type'].map(k=>r[k]));
  const p=previewHoboCleanup(d,{serial,from:'2026-10-01',to:'2026-10-01'},'admin');await confirmHoboCleanup(d,{id:p.id,actor:'admin',confirmation:'DELETE'},async()=>'/fake');
  await runHoboCleanup(d,{purge:()=>assert.fail('local-only cleanup must not call S3')});
  assert.equal(d.prepare('SELECT value FROM hobo_observations').get().value,2);d.close();
});

test('S3 cleanup inventories all versions and delete markers with pagination, rejecting unrelated keys and partial failures',async()=>{
  const scope={serial,day:'2026-10-01',bucket:configuration.bucket,region:configuration.region};
  const key=`hobo/${serial}/2026/10/01/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/${'a'.repeat(64)}.jsonl.gz`;
  const seen=[];const client={async send(command){const {input}=command,name=command.constructor.name;seen.push({name,input});
    if(name==='GetBucketVersioningCommand')return {Status:'Suspended'};
    if(!input.KeyMarker)return {Versions:[{Key:key,VersionId:'v1',Size:10}],IsTruncated:true,NextKeyMarker:key,NextVersionIdMarker:'v1'};
    return {DeleteMarkers:[{Key:key,VersionId:'delete-marker'}],IsTruncated:false};
  }};
  const objects=await hoboObjectVersions(scope,client);assert.deepEqual(objects.map(r=>r.VersionId),['v1','delete-marker']);
  assert.equal(seen.at(-1).input.VersionIdMarker,'v1');
  const unsafe={async send(command){return command.constructor.name==='GetBucketVersioningCommand'?{Status:'Enabled'}:{Versions:[{Key:'processed/other-file',VersionId:'v1'}]};}};
  await assert.rejects(hoboObjectVersions(scope,unsafe),/範圍外/);
});

test('S3 mode is explicitly opt-in and cleanup IAM policy is additive and restricted to hobo prefix',()=>{
  assert.equal(hoboStorageConfiguration({}).mode,'local');assert.throws(()=>hoboStorageConfiguration({HOBO_STORAGE:'s3'}),/S3_BUCKET/);
  assert.equal(hoboDayRange('2026-10-01').start,'2026-09-30T16:00:00.000Z');
  const policy=JSON.parse(readFileSync(new URL('../scripts/iam-hobo-cleanup.json',import.meta.url),'utf8'));
  assert.equal(policy.Statement[1].Condition.StringLike['s3:prefix'],'hobo/*');
  assert.ok(policy.Statement[2].Resource.endsWith('/hobo/*'));assert.deepEqual(policy.Statement[2].Action,['s3:DeleteObject','s3:DeleteObjectVersion']);
});

test('cleanup API blocks members and foreign origins before preview or deletion',async()=>{
  const d=database();let role='member',allowed=true;
  class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
  const cleanup=await import('../lib/hobo-cleanup.mjs'),hobo=await import('../lib/hobo.mjs');
  const deps={'@/lib/server':{identity:async()=>({role,email:'admin'}),AppError,writeGuard:()=>{if(!allowed)throw new AppError(403,'origin');},fail:e=>Response.json({error:e.message},{status:e.status||500})},'@/lib/store.mjs':{getConnection:()=>d},'@/lib/hobo.mjs':hobo,'@/lib/hobo-cleanup.mjs':cleanup};
  const source=readFileSync(new URL('../app/api/hobo/cleanup/route.ts',import.meta.url),'utf8');const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};new Function('require','exports','module',code)(name=>{assert.ok(name in deps,name);return deps[name];},module.exports,module);
  const {GET,POST}=module.exports;assert.equal((await GET(new Request('http://local/api/hobo/cleanup'))).status,403);
  assert.equal((await POST(new Request('http://local/api/hobo/cleanup',{method:'POST',body:'{}'}))).status,403);
  role='admin';allowed=false;assert.equal((await POST(new Request('http://local/api/hobo/cleanup',{method:'POST'}))).status,403);
  assert.equal((await GET(new Request('http://local/api/hobo/cleanup'))).status,200);d.close();
});
