const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function time(value){
  const date=new Date(value);if(!value||!Number.isFinite(date.getTime()))return '無資料 / Not available';
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date);
}
function duration(minutes,en=false){
  const total=Math.max(0,Math.floor(Number(minutes)||0)),days=Math.floor(total/1440),hours=Math.floor(total%1440/60),mins=total%60;
  const values=[[days,'天','day'],[hours,'小時','hour'],[mins,'分鐘','minute']];
  return values.filter(([n])=>n).map(([n,zh,english])=>en?`${n} ${english}${n===1?'':'s'}`:`${n} ${zh}`).join(' ')||(en?'less than 1 minute':'不足 1 分鐘');
}
export function buildOfflineNotification({maintainer,items,thresholdMins,checkId,checkedAt,unknownCount=0}){
  const name=String(maintainer??'').replace(/[\r\n]+/g,' '),count=items.length;
  const subject=`[ASLUNG 設備斷線通知 / Device Disconnection Notification] 負責設備共 ${count} 台斷線超過 ${thresholdMins} 分鐘 / ${count} ${count===1?'device':'devices'} offline for over ${thresholdMins} minutes (負責人 / Maintainer: ${name})`;
  const rows=items.map(item=>{
    const offline=item.last_seen?`${duration(item.offline_mins)} / ${duration(item.offline_mins,true)}`:'從未上傳 / No uploads received';
    return {device:String(item.aslung_id??''),lab:String(item.lab_id??''),offline,last:time(item.last_seen)};
  });
  const unknown=unknownCount?`本次另有 ${unknownCount} 台設備查詢失敗，未計入斷線數量。 / Queries failed for ${unknownCount} additional ${unknownCount===1?'device':'devices'}; these were excluded from the offline count.`:'';
  const instructionsZh='請儘速確認儀器電源、Wi-Fi 網路連線與現場設置環境。';
  const instructionsEn='Please check the device power supply, Wi-Fi connection and on-site installation.';
  const checked=time(checkedAt);
  const text=[
    'ASLUNG 設備斷線通知 / ASLUNG Device Disconnection Notification',
    `您好 ${name}，系統發現您負責維護的使用中 ASLUNG 設備，共 ${count} 台超過 ${thresholdMins} 分鐘未收到新上傳資料。`,
    `Hello ${name}, monitoring found ${count} active ASLUNG ${count===1?'device':'devices'} assigned to you with no new data received for over ${thresholdMins} minutes.`,
    'ASLUNG ID | 目前位置 / Location | 離線時間 / Offline duration | 最後上傳時間 / Last upload (UTC+8, Asia/Taipei)',
    ...rows.map(row=>`${row.device} | ${row.lab} | ${row.offline} | ${row.last}`),
    instructionsZh,instructionsEn,`檢查編號：${checkId} / Check ID: ${checkId}`,`判定時間 / Checked at: ${checked} (UTC+8, Asia/Taipei)`,unknown,
    '此郵件由 ASLUNG 系統自動發送，請勿直接回覆。 / This is an automated ASLUNG notification. Please do not reply.'
  ].filter(Boolean).join('\n\n');
  const html=`<div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;padding:20px;color:#334155">
    <h2 style="color:#0f766e">ASLUNG 設備斷線通知<br><span lang="en">ASLUNG Device Disconnection Notification</span></h2>
    <p lang="zh-Hant">您好 <strong>${escapeHtml(name)}</strong>，系統發現您負責維護的使用中 ASLUNG 設備，共 <strong>${count} 台</strong>超過 <strong>${thresholdMins} 分鐘</strong>未收到新上傳資料。</p>
    <p lang="en">Hello <strong>${escapeHtml(name)}</strong>, monitoring found <strong>${count} active ASLUNG ${count===1?'device':'devices'}</strong> assigned to you with no new data received for over <strong>${thresholdMins} minutes</strong>.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left"><thead><tr style="background:#f8fafc"><th>ASLUNG ID</th><th>目前位置<br>Location</th><th>離線時間<br>Offline duration</th><th>最後上傳時間<br>Last upload (UTC+8, Asia/Taipei)</th></tr></thead><tbody>
    ${rows.map(row=>`<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:10px">${escapeHtml(row.device)}</td><td>${escapeHtml(row.lab)}</td><td style="color:#dc2626">${escapeHtml(row.offline)}</td><td>${escapeHtml(row.last)}</td></tr>`).join('')}
    </tbody></table>
    <p style="background:#fef2f2;padding:12px">${instructionsZh}<br><span lang="en">${instructionsEn}</span></p>
    <p style="font-size:12px">檢查編號：${checkId} / Check ID: ${checkId}<br>判定時間 / Checked at: ${escapeHtml(checked)} (UTC+8, Asia/Taipei)<br>${escapeHtml(unknown)}</p>
    <p style="font-size:11px;color:#64748b">此郵件由 ASLUNG 系統自動發送，請勿直接回覆。<br>This is an automated ASLUNG notification. Please do not reply.</p>
  </div>`;
  return {subject,text,html};
}
