import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import * as policy from '../lib/alert-policy.mjs';
import * as maintainerLinks from '../lib/maintainer-links.mjs';
import * as notification from '../lib/offline-notification.mjs';

function loadTs(path, dependencies) {
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  new Function('require','exports','module',code)(name=>{
    if(!(name in dependencies))throw new Error('Unexpected import: '+name);
    return dependencies[name];
  },module.exports,module);
  return module.exports;
}
const locks=loadTs('../lib/alert-lock.ts',{'node:crypto':crypto});
function makeStore(sql) {
  return {prepare(query){let args=[];return {
    bind(...values){args=values;return this;},
    async first(){return sql.prepare(query).get(...args)??null;},
    async all(){return {results:sql.prepare(query).all(...args)};},
    async run(){return sql.prepare(query).run(...args);}
  };}};
}
function fixture(query, send) {
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE alert_settings(id INTEGER PRIMARY KEY,enabled INTEGER,schedule_type TEXT,
    check_interval_mins INTEGER,offline_threshold_mins INTEGER,smtp_host TEXT,smtp_user TEXT,smtp_pass TEXT,
    smtp_port INTEGER,smtp_from TEXT,use_test_email INTEGER,last_check_at TEXT,last_alert_at TEXT);
    INSERT INTO alert_settings VALUES(1,1,'interval',60,60,'smtp.test','test','secret',587,'test@example.test',0,NULL,NULL);
    CREATE TABLE devices(id TEXT,name TEXT,location TEXT,status TEXT);
    CREATE TABLE device_locations(aslung_id TEXT,lab_id TEXT,maintainer TEXT,start_time TEXT,end_time TEXT,active INTEGER);
    CREATE TABLE members(email TEXT PRIMARY KEY,active INTEGER,alert_email_enabled INTEGER DEFAULT 1);
    CREATE TABLE maintainers(name TEXT,email TEXT,email_test TEXT);
    INSERT INTO maintainers VALUES('Maintainer','owner@example.test','');
    CREATE TABLE alert_checks(id INTEGER PRIMARY KEY,check_type TEXT,total_devices INTEGER,offline_count INTEGER,
      notified_maintainers INTEGER,status TEXT,summary TEXT,created_at TEXT);
    CREATE TABLE alert_logs(id INTEGER PRIMARY KEY,check_id INTEGER,aslung_id TEXT,lab_id TEXT,maintainer TEXT,
      email TEXT,last_seen TEXT,offline_mins INTEGER,status TEXT,error_message TEXT,created_at TEXT);`);
  for(const id of ['old','fresh','empty','error']) {
    sql.prepare("INSERT INTO devices VALUES(?,?,?,'DEPLOYED')").run(id,id,'');
    sql.prepare("INSERT INTO device_locations VALUES(?,'Lab','Maintainer','2026-01-01',NULL,1)").run(id);
  }
  const store=makeStore(sql),mails=[];
  const deps={
    nodemailer:{createTransport:()=>({sendMail:async mail=>{mails.push(mail);await send?.(mail);}})},
    '@/lib/server':{db:()=>store,syncDeviceStatusesAndLocations:async()=>{}},
    '@/lib/data':{getPool:()=>({query:query|| (async(options,[id])=>{
      assert.equal(options.timeout,20000);
      if(id==='error')throw new Error('database unavailable');
      return [id==='empty'?[]:[{time:new Date(Date.now()-(id==='old'?120:0)*60000)}]];
    })})},
    '@/lib/utils':{formatOfflineDuration:mins=>`${mins} minutes`},
    './alert-policy.mjs':policy,'./maintainer-links.mjs':maintainerLinks,
    './offline-notification.mjs':notification,
    './alert-lock':locks
  };
  return {sql,store,mails,load:()=>loadTs('../lib/alerts.ts',deps)};
}

test('lease is shared, can recover after expiry, and old owner cannot release its successor',async()=>{
  const sql=new DatabaseSync(':memory:'),store=makeStore(sql);
  try {
    const first=await locks.acquireAlertLock(store);
    assert.ok(first);
    assert.equal(await locks.acquireAlertLock(store),null);
    sql.exec('UPDATE alert_execution_lock SET expires_at=0');
    const second=await locks.acquireAlertLock(store);
    assert.ok(second);
    await assert.rejects(first.assertOwned(),/鎖已失效/);
    await first.release();
    await second.assertOwned();
    await second.release();
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM alert_execution_lock').get().n,0);
  }finally{sql.close();}
});

test('parallel server bundles and manual trigger share one execution; completed schedule is not resent',async()=>{
  let unblock,entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  const hold=new Promise(resolve=>{unblock=resolve;});
  const f=fixture(async(options,[id])=>{entered();await hold;return [[{time:new Date(Date.now()-120*60000)}]];});
  try {
    const a=f.load(),b=f.load();
    const running=a.checkAndSendOfflineAlerts();
    await ready;
    const other=await b.checkAndSendOfflineAlerts();
    const manual=await b.checkAndSendOfflineAlerts({force:true});
    assert.equal(other.skipped,true);assert.equal(manual.skipped,true);
    unblock();
    await running;
    assert.equal(f.mails.length,1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM alert_checks').get().n,1);
    assert.equal((await b.checkAndSendOfflineAlerts()).skipped,true);
    assert.equal(f.mails.length,1);
    // The next configured interval still sends a reminder for ongoing outages.
    f.sql.exec("UPDATE alert_settings SET last_check_at='2000-01-01T00:00:00Z'");
    await b.checkAndSendOfflineAlerts();
    assert.equal(f.mails.length,2);
  }finally{unblock();f.sql.close();}
});
test('explicit maintainer account links route alerts to linked members and respect their opt-out',async()=>{
  const f=fixture();try{
    f.sql.exec(`ALTER TABLE members ADD COLUMN user_id TEXT;
      CREATE UNIQUE INDEX members_user_id ON members(user_id);
      INSERT INTO members(email,active,alert_email_enabled,user_id) VALUES('linked@example.test',1,1,'linked');`);
    maintainerLinks.ensureMaintainerLinkSchema(f.sql);
    const id=f.sql.prepare("SELECT maintainer_id FROM maintainers WHERE name='Maintainer'").get().maintainer_id;
    f.sql.prepare('INSERT INTO member_maintainer_links VALUES(?,?,?,?)').run('linked',id,'admin@test',new Date().toISOString());
    f.sql.prepare('INSERT INTO maintainer_link_routing VALUES(?)').run(id);
    await f.load().checkAndSendOfflineAlerts({force:true});
    assert.equal(f.mails.length,1);assert.equal(f.mails[0].to,'linked@example.test');
    f.sql.exec("UPDATE members SET alert_email_enabled=0 WHERE user_id='linked'");
    await f.load().checkAndSendOfflineAlerts({force:true});assert.equal(f.mails.length,1);
    f.sql.exec("DELETE FROM member_maintainer_links WHERE member_user_id='linked'");
    await f.load().checkAndSendOfflineAlerts({force:true});assert.equal(f.mails.length,1);
  }finally{f.sql.close();}
});

test('query failure is unknown, empty data is offline, and email/log counts use one check snapshot',async()=>{
  const f=fixture();
  try {
    const result=await f.load().checkAndSendOfflineAlerts();
    assert.equal(result.offlineCount,2);assert.equal(result.unknownCount,1);
    assert.equal(f.mails.length,1);assert.match(f.mails[0].subject,/共 1 台/);
    assert.match(f.mails[0].subject,/設備斷線通知/);assert.match(f.mails[0].subject,/Device Disconnection Notification/);
    assert.match(f.mails[0].html,/Location/);assert.match(f.mails[0].text,/Please check the device power supply/);
    assert.doesNotMatch(f.mails[0].subject+f.mails[0].html+f.mails[0].text,/設備斷線告警/);
    assert.match(f.mails[0].html,new RegExp(`檢查編號：${result.checkId}`));
    const logs=f.sql.prepare('SELECT * FROM alert_logs ORDER BY aslung_id').all();
    assert.equal(logs.find(l=>l.aslung_id==='error').status,'UNKNOWN');
    assert.equal(logs.find(l=>l.aslung_id==='empty').status,'SKIPPED');
    assert.equal(logs.some(l=>l.aslung_id==='fresh'),false);
    const check=f.sql.prepare('SELECT * FROM alert_checks').get();
    assert.equal(check.offline_count,2);assert.match(check.summary,/1 台查詢失敗/);
    assert.equal(check.status,'FAILED');
    assert.ok(logs.every(l=>l.check_id===result.checkId&&l.created_at===result.checkedAt));
  }finally{f.sql.close();}
});

test('schedule is reserved before SMTP, including ambiguous SMTP failure',async()=>{
  const f=fixture(undefined,async()=>{
    assert.ok(f.sql.prepare('SELECT last_check_at FROM alert_settings').get().last_check_at);
    throw new Error('SMTP timeout after possible acceptance');
  });
  try {
    const first=await f.load().checkAndSendOfflineAlerts();
    assert.equal(first.details[0].status,'FAILED');
    assert.equal((await f.load().checkAndSendOfflineAlerts()).skipped,true);
    assert.equal(f.mails.length,1);
  }finally{f.sql.close();}
});

test('unexpected failure releases lease so a later check can run',async()=>{
  const f=fixture();
  try {
    f.sql.exec('DROP TABLE devices');
    await assert.rejects(f.load().checkAndSendOfflineAlerts(),/no such table/);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM alert_execution_lock').get().n,0);
  }finally{f.sql.close();}
});

test('server bundles initialize only one background timer',()=>{
  const f=fixture();
  const previous=globalThis.aslungAlertCron;
  delete globalThis.aslungAlertCron;
  try {
    f.load().initAlertCron();
    const timer=globalThis.aslungAlertCron;
    assert.ok(timer);
    f.load().initAlertCron();
    assert.equal(globalThis.aslungAlertCron,timer);
  }finally{
    clearInterval(globalThis.aslungAlertCron);
    if(previous)globalThis.aslungAlertCron=previous;
    else delete globalThis.aslungAlertCron;
    f.sql.close();
  }
});

test('startup hook starts scheduling without a browser and skips build workers',async()=>{
  const runtime=process.env.NEXT_RUNTIME,phase=process.env.NEXT_PHASE;
  let starts=0;
  const hook=loadTs('../instrumentation.ts',{'./lib/alerts':{initAlertCron(){starts++;}},'./lib/calibration-cron':{initCalibrationCron(){}},'./lib/personal-cron':{initPersonalCron(){}}});
  try {
    process.env.NEXT_RUNTIME='nodejs';
    process.env.NEXT_PHASE='phase-production-build';
    await hook.register();assert.equal(starts,0);
    process.env.NEXT_PHASE='phase-production-server';
    await hook.register();assert.equal(starts,1);
  }finally{
    if(runtime===undefined)delete process.env.NEXT_RUNTIME;else process.env.NEXT_RUNTIME=runtime;
    if(phase===undefined)delete process.env.NEXT_PHASE;else process.env.NEXT_PHASE=phase;
  }
});


test('old and never-uploaded devices remain warnings but never enter the email body or count',async()=>{
  const f=fixture(async(options,[id])=>[id==='empty'?[]:[{time:new Date(id==='old'?'2020-01-01T00:00:00Z':Date.now()-120*60000)}]]);
  try{
    const result=await f.load().checkAndSendOfflineAlerts({force:true});
    assert.equal(result.offlineCount,4);assert.equal(result.notifiedMaintainers,1);
    assert.match(f.mails[0].subject,/共 2 台/);
    assert.doesNotMatch(f.mails[0].html,/>old<|>empty</);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM alert_logs WHERE status='SKIPPED'").get().n,2);
    assert.equal(f.sql.prepare('SELECT notified_maintainers FROM alert_checks').get().notified_maintainers,1);
  }finally{f.sql.close();}
});

for(const mode of ['disabled','inactive','test-routing'])test(`recipient opt-out is honored: ${mode}`,async()=>{
  const f=fixture();
  try{
    f.sql.prepare('INSERT INTO members VALUES(?,?,?)').run('OWNER@example.test',mode==='inactive'?0:1,mode==='inactive'?1:0);
    if(mode==='test-routing')f.sql.exec("UPDATE alert_settings SET use_test_email=1; UPDATE maintainers SET email_test='alternate@example.test'");
    const result=await f.load().checkAndSendOfflineAlerts({force:true});
    assert.equal(f.mails.length,0);assert.equal(result.offlineCount,2);assert.equal(result.notifiedMaintainers,0);
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM alert_logs WHERE status='SKIPPED'").get().n,2);
    assert.equal(f.sql.prepare('SELECT notified_maintainers FROM alert_checks').get().notified_maintainers,0);
    assert.equal(f.sql.prepare('SELECT last_alert_at FROM alert_settings').get().last_alert_at,null);
  }finally{f.sql.close();}
});

test('a group with only excluded devices has no email and SKIPPED status',async()=>{
  const f=fixture(async()=>[[]]);
  try{
    const result=await f.load().checkAndSendOfflineAlerts({force:true});
    assert.equal(result.offlineCount,4);assert.equal(result.notifiedMaintainers,0);assert.equal(f.mails.length,0);
    assert.equal(f.sql.prepare('SELECT status FROM alert_checks').get().status,'SKIPPED');
  }finally{f.sql.close();}
});

test('one-year boundary uses calendar years, including leap day; recipient lists filter individually',()=>{
  const now=new Date('2026-10-19T10:00:00Z');
  assert.equal(policy.alertEmailExclusion('2025-10-19T10:00:00Z',now),'');
  assert.ok(policy.alertEmailExclusion('2025-10-19T09:59:59Z',now));
  assert.equal(policy.alertEmailExclusion('2023-02-28T10:00:00Z',new Date('2024-02-29T10:00:00Z')),'');
  assert.ok(policy.alertEmailExclusion(null,now));assert.ok(policy.alertEmailExclusion('bad',now));
  assert.deepEqual(policy.alertRecipients('A@test; b@test, c@test, C@test',[{email:'a@test',active:1,alert_email_enabled:0},{email:'b@test',active:0,alert_email_enabled:1}]),['c@test']);
});
