import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflineNotification} from '../lib/offline-notification.mjs';
const sample={maintainer:'劉純湖',thresholdMins:60,checkId:123,checkedAt:new Date('2026-10-30T01:00:00Z'),unknownCount:1,items:[
  {aslung_id:'AL-1',lab_id:'C0015',offline_mins:120,last_seen:'2026-10-29T23:00:00Z'},
  {aslung_id:'AL-2',lab_id:'C0016',offline_mins:1501,last_seen:'2026-10-28T23:59:00Z'}]};
test('one notification has a bilingual subject, HTML and plain text with explicit Taipei times',()=>{
  const mail=buildOfflineNotification(sample);
  for(const output of [mail.subject,mail.html,mail.text]){assert.match(output,/設備斷線通知/);assert.match(output,/Device Disconnection Notification/);assert.doesNotMatch(output,/告警/);assert.match(output,/劉純湖/);}
  for(const output of [mail.html,mail.text])for(const value of ['AL-1','AL-2','C0015','C0016','2 小時','2 hours','1 天 1 小時 1 分鐘','1 day 1 hour 1 minute','2026-10-30 09:00:00','UTC+8','Asia/Taipei','Check ID: 123','queries failed']){
    assert.ok(output.toLowerCase().includes(value.toLowerCase()),value);
  }
  assert.match(mail.subject,/共 2 台/);assert.match(mail.subject,/2 devices offline for over 60 minutes/);
});
test('notification escapes dynamic HTML and strips header newlines without changing IDs in plain text',()=>{
  const mail=buildOfflineNotification({...sample,maintainer:'<img src=x>\r\nInjected',items:[{aslung_id:'AL-<1>',lab_id:'A&B "Site"',offline_mins:60,last_seen:'2026-10-30T00:00:00Z'}],unknownCount:0});
  assert.doesNotMatch(mail.html,/<img|AL-<1>/);assert.match(mail.html,/&lt;img src=x&gt;/);assert.match(mail.html,/A&amp;B &quot;Site&quot;/);
  assert.doesNotMatch(mail.subject,/[\r\n]/);assert.match(mail.subject,/1 device offline/);assert.match(mail.html,/1 hour/);assert.doesNotMatch(mail.text,/Queries failed/);
});
test('missing or invalid upload times do not print invalid dates',()=>{
  const mail=buildOfflineNotification({...sample,items:[{aslung_id:'AL-1',lab_id:'Lab',offline_mins:99999,last_seen:null},{aslung_id:'AL-2',lab_id:'Lab',offline_mins:0,last_seen:'bad-date'}]});
  assert.match(mail.text,/從未上傳 \/ No uploads received/);assert.match(mail.text,/無資料 \/ Not available/);assert.doesNotMatch(mail.html,/Invalid Date/);assert.match(mail.text,/less than 1 minute/);
});
