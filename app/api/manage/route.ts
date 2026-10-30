import {getConnection} from "@/lib/store.mjs";
import {validateProfile,saveProfile,reviewRegistration,RegistrationError} from "@/lib/registration.mjs";
import {registrationMailer} from "@/lib/registration-mail";
import crypto from "node:crypto";
import {ADMIN_REALTIME_INTERVALS, normalizeRealtimeInterval, normalizeRealtimeCacheSeconds, validRealtimeCacheSeconds} from "@/lib/realtime-settings.mjs";
import {randomUUID} from "node:crypto";
import {hashPassword,validPassword} from "@/lib/passwords.mjs";
import {downloadSegments,admin,identity,db,config,fail,writeGuard,required,instant,AppError,syncDeviceStatusesAndLocations,getSiteStats} from "@/lib/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function protectMaintenanceHistory(ids:string[]){
  const d=getConnection();
  if(!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_orders'").get())return;
  for(const id of ids)if(d.prepare('SELECT 1 FROM maintenance_orders WHERE device_id=? LIMIT 1').get(id))throw new AppError(409,`設備 ${id} 已有維修保養紀錄，請改為報廢或停用以保留歷程。`);
}
function deleteDevicesWithHistoryProtection(ids:string[]){
  const d=getConnection();d.exec('BEGIN IMMEDIATE');
  try{protectMaintenanceHistory(ids);
    if(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='device_ownerships'").get())for(const id of ids)if(d.prepare('SELECT 1 FROM device_ownerships WHERE device_id=? LIMIT 1').get(id))throw new AppError(409,`設備 ${id} 已有會員歸屬紀錄，請改為停用或報廢以保留交接歷史。`);
    for(const id of ids){
    d.prepare('DELETE FROM grants WHERE device_id=?').run(id);
    d.prepare('DELETE FROM device_locations WHERE aslung_id=?').run(id);
    d.prepare('DELETE FROM devices WHERE id=?').run(id);
  }d.exec('COMMIT');}catch(e){d.exec('ROLLBACK');throw e;}
}
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        cur += c;
        i++;
        continue;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (c === ',') {
        row.push(cur.trim());
        cur = "";
        i++;
        continue;
      } else if (c === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') i++;
        row.push(cur.trim());
        cur = "";
        if (row.some(cell => cell.length > 0)) rows.push(row);
        row = [];
        i++;
        continue;
      } else if (c === '\n') {
        row.push(cur.trim());
        cur = "";
        if (row.some(cell => cell.length > 0)) rows.push(row);
        row = [];
        i++;
        continue;
      } else {
        cur += c;
        i++;
        continue;
      }
    }
  }
  row.push(cur.trim());
  if (row.some(cell => cell.length > 0)) rows.push(row);
  return rows;
}

export async function GET(request:Request){try{
 const m=await identity();const isAdmin=m.role==="admin";
 // Keep legacy clients compatible; the workspace requests only its current page.
 const scope=request?new URL(request.url).searchParams.get('scope')||'full':'full';
 const scopes=['full','bootstrap','news','articles','realtime','data','devices','maintenance','calibration','personal','hobo','members','permissions','locations','labs','maintainers','alerts','files','connection'];
 if(!scopes.includes(scope))throw new AppError(400,'無效的工作空間頁面。');
 const needs=(...pages:string[])=>scope==='full'||pages.includes(scope);
 const needDevices=needs('realtime','data','devices','permissions','locations','labs','maintainers','alerts','members');
 const needAlerts=needs('alerts');
 const needRequests=needs('permissions','data');
 const needSegments=needs('data')||(!isAdmin&&needDevices);
 const needLocations=needs('realtime','devices','locations','labs','maintainers','alerts','data');
 const needMaintainers=needs('realtime','devices','locations','maintainers','alerts');
 const needMembers=needs('members','permissions','devices','files','locations');
 const needGrants=needs('permissions','devices');
 const needLabs=needs('data','devices','locations','labs','permissions','members');
 const needFiles=needs('files');
 const navMaintainer=!!(await db().prepare(`SELECT 1 FROM maintainers WHERE LOWER(email)=LOWER(?)
   OR (?=1 AND TRIM(name)<>'' AND TRIM(name) IN (?,?)) UNION ALL
   SELECT 1 FROM device_locations WHERE ?=1 AND TRIM(maintainer)<>'' AND TRIM(maintainer) IN (?,?) LIMIT 1`)
   .bind(m.email,m.allowMaintainerNameMatch?1:0,String(m.name||'').trim(),String(m.nickname||'').trim(),m.allowMaintainerNameMatch?1:0,String(m.name||'').trim(),String(m.nickname||'').trim()).first());
 let devices: any[] = [];
 let alertChecks: any[] = [];
 let alertLogs: any[] = [];
 let grantRequests: any[] = [];

 if (isAdmin) {
   devices = needDevices?(await db().prepare("SELECT * FROM devices ORDER BY id").all()).results:[];
   alertChecks = needAlerts?(await db().prepare("SELECT * FROM alert_checks ORDER BY created_at DESC LIMIT 100").all()).results:[];
   alertLogs = needAlerts?(await db().prepare("SELECT * FROM alert_logs ORDER BY created_at DESC LIMIT 500").all()).results:[];
   grantRequests = needRequests?(await db().prepare(`
    SELECT gr.*, m.name as member_name, m.nickname as member_nickname, l.location_name, l.city_name, l.town_name
    FROM grant_requests gr
    LEFT JOIN members m ON m.email = gr.email
    LEFT JOIN labs l ON l.id = gr.lab_id
    ORDER BY CASE WHEN gr.status='PENDING' THEN 0 ELSE 1 END, gr.created_at DESC LIMIT 200
  `).all()).results:[];
 } else {
   grantRequests = needRequests?(await db().prepare(`
    SELECT gr.*, l.location_name, l.city_name, l.town_name
    FROM grant_requests gr
    LEFT JOIN labs l ON l.id = gr.lab_id
    WHERE gr.email=?
    ORDER BY gr.created_at DESC LIMIT 50
  `).bind(m.email).all()).results:[];
   if(needDevices){
   // 1. Authorized devices by grants
   const grantedDevs = (await db().prepare("SELECT d.*, g.start, g.end FROM devices d JOIN grants g ON g.device_id=d.id WHERE g.email=? AND (g.grant_type='device' OR g.grant_type IS NULL) ORDER BY d.id").bind(m.email).all()).results as any[];

    // 2. Authorized devices by lab grants
    const labGrants = (await db().prepare(`
      SELECT g.*, l.location_name, l.city_name, l.town_name
      FROM grants g
      LEFT JOIN labs l ON l.id = g.lab_id
      WHERE g.email=? AND g.grant_type='lab'
    `).bind(m.email).all()).results as any[];

    const labGrantedDevs: any[] = [];
    for (const lg of labGrants) {
      const labName = [lg.city_name, lg.town_name, lg.location_name].filter(Boolean).join(" ") || lg.lab_id;
      const devsAtLab = (await db().prepare(`
        SELECT DISTINCT d.*
        FROM devices d
        LEFT JOIN device_locations dl ON dl.aslung_id = d.id
        WHERE d.location = ? OR dl.lab_id = ?
      `).bind(lg.lab_id, lg.lab_id).all()).results as any[];

      for (const d of devsAtLab) {
        const locHistory = (await db().prepare(`
          SELECT start_time, end_time, active
          FROM device_locations
          WHERE aslung_id = ? AND lab_id = ?
          ORDER BY start_time ASC
        `).bind(d.id, lg.lab_id).all()).results as any[];

        const ranges: Array<{ start: string; end: string | null; active: boolean }> = [];
        let isActiveAtLab = false;
        if (locHistory.length > 0) {
          for (const loc of locHistory) {
            if (loc.active === 1 && !loc.end_time) isActiveAtLab = true;
            ranges.push({
              start: loc.start_time,
              end: loc.end_time || null,
              active: loc.active === 1 && !loc.end_time
            });
          }
        } else {
          isActiveAtLab = true;
          ranges.push({ start: lg.start, end: lg.end || null, active: true });
        }

        const latestRange = ranges.length > 0 ? ranges[ranges.length - 1] : null;
        const effectiveStart = latestRange ? latestRange.start : lg.start;
        const effectiveEnd = latestRange ? latestRange.end : lg.end;

        labGrantedDevs.push({
          ...d,
          start: effectiveStart,
          end: effectiveEnd,
          grant_lab_id: lg.lab_id,
          grant_lab_name: labName,
          tracking_ranges: ranges,
          is_active_at_lab: isActiveAtLab
        });
      }
    }

    // 2. Devices maintained by this member (matched by name or maintainer email)
    const mName = m.allowMaintainerNameMatch ? String(m.name || "").trim() : "";
    const maintainerRows = (await db().prepare("SELECT name FROM maintainers WHERE LOWER(email)=LOWER(?)").bind(m.email).all()).results as any[];
    const maintainerNames = Array.from(new Set([mName, ...maintainerRows.map(r => String(r.name || "").trim())].filter(Boolean)));

    let maintainedDevs: any[] = [];
    if (maintainerNames.length > 0) {
      const placeholders = maintainerNames.map(() => "?").join(",");
      maintainedDevs = (await db().prepare(`
        SELECT DISTINCT d.*, NULL as start, NULL as end
        FROM devices d
        JOIN device_locations dl ON dl.aslung_id = d.id
        WHERE TRIM(dl.maintainer) IN (${placeholders})
        ORDER BY d.id
      `).bind(...maintainerNames).all()).results as any[];
    }
   // Merge devices (deduplicate by id, add flags & grant source)
   const devMap = new Map<string, any>();
   for (const d of grantedDevs) {
     devMap.set(d.id, { ...d, is_granted: true, is_maintained: false, grant_source: "device" });
   }
   for (const d of labGrantedDevs) {
     if (devMap.has(d.id)) {
       const existing = devMap.get(d.id);
       existing.is_granted = true;
       existing.grant_lab_id = d.grant_lab_id;
       existing.grant_lab_name = d.grant_lab_name;
       existing.grant_source = "both";
     } else {
       devMap.set(d.id, {
         ...d,
         is_granted: true,
         is_maintained: false,
         grant_source: "lab",
         grant_lab_id: d.grant_lab_id,
         grant_lab_name: d.grant_lab_name
       });
     }
   }
   for (const d of maintainedDevs) {
     if (devMap.has(d.id)) {
       devMap.get(d.id).is_maintained = true;
     } else {
       devMap.set(d.id, { ...d, is_granted: false, is_maintained: true, grant_source: "maintainer" });
     }
   }
   devices = Array.from(devMap.values()).sort((a, b) => a.id.localeCompare(b.id));

   // 3. Alert logs for this member's devices or maintainer name
   const allDeviceIds = devices.map(d => d.id);
   if (needAlerts&&(allDeviceIds.length > 0 || maintainerNames.length > 0)) {
     const devPlaceholders = allDeviceIds.length > 0 ? allDeviceIds.map(() => "?").join(",") : "''";
     const namePlaceholders = maintainerNames.length > 0 ? maintainerNames.map(() => "?").join(",") : "''";
     const bindParams = [...allDeviceIds, ...maintainerNames];
     
     alertLogs = (await db().prepare(`
       SELECT * FROM alert_logs
       WHERE aslung_id IN (${devPlaceholders})
          OR TRIM(maintainer) IN (${namePlaceholders})
       ORDER BY created_at DESC LIMIT 200
     `).bind(...bindParams).all()).results;
     const checkIds = Array.from(new Set(alertLogs.map((l: any) => l.check_id).filter(Boolean)));
     if (checkIds.length > 0) {
       const checkPh = checkIds.map(() => "?").join(",");
       alertChecks = (await db().prepare(`
         SELECT * FROM alert_checks
         WHERE id IN (${checkPh})
         ORDER BY created_at DESC LIMIT 100
       `).bind(...checkIds).all()).results;
     }
   }
   }
 }
 const members=isAdmin&&needMembers?(await db().prepare("SELECT m.email,m.name,m.nickname,m.role,m.active,m.alert_email_enabled,m.login_count,m.last_login_at,p.country,p.institution,p.project_name,p.project_summary,p.requested_access,p.registration_status,p.registered_at,p.email_verified_at,p.reviewed_at,p.reviewed_by,p.review_note FROM members m LEFT JOIN member_profiles p ON p.email=m.email ORDER BY CASE WHEN p.registration_status='pending_review' THEN 0 ELSE 1 END,m.role,m.email").all()).results:[];
 const totalLogins=((await db().prepare("SELECT COALESCE(SUM(login_count), 0) as total FROM members").first()) as any)?.total || 0;
 const grants=isAdmin&&needGrants?(await db().prepare(`
  SELECT g.*, l.location_name, l.city_name, l.town_name,
    (SELECT COUNT(DISTINCT d.id) FROM devices d LEFT JOIN device_locations dl ON dl.aslung_id = d.id WHERE (g.grant_type='lab' AND (d.location = g.lab_id OR dl.lab_id = g.lab_id))) as lab_device_count
  FROM grants g
  LEFT JOIN labs l ON l.id = g.lab_id
  ORDER BY g.grant_type DESC, g.lab_id, g.device_id, g.email, g.start DESC
`).all()).results:[];
 const locations=needLocations?(await db().prepare("SELECT * FROM device_locations ORDER BY start_time DESC").all()).results:[];
 const tokens=needs('connection')?(await db().prepare("SELECT id, created_at FROM api_tokens WHERE email=? ORDER BY created_at DESC").bind(m.email).all()).results:[];
 const files=needFiles?(await (isAdmin?db().prepare("SELECT * FROM files ORDER BY created_at DESC"):db().prepare("SELECT f.* FROM files f JOIN file_grants fg ON fg.file_id=f.id WHERE fg.email=? ORDER BY f.created_at DESC").bind(m.email)).all()).results:[];
 const fileGrants=isAdmin&&needFiles?(await db().prepare("SELECT * FROM file_grants").all()).results:[];
 const labs=needLabs?(await db().prepare("SELECT * FROM labs ORDER BY id").all()).results:[];
 const maintainers=needMaintainers?(await db().prepare("SELECT * FROM maintainers ORDER BY name").all()).results:[];
 const alertSettingsRaw=(await db().prepare("SELECT * FROM alert_settings WHERE id=1").first()) as any;
 const alertSettings = {
   id: 1, enabled: 1, schedule_type: "interval", schedule_time: "09:00", schedule_days: "1,2,3,4,5", timezone: "Asia/Taipei",
   check_interval_mins: 60, offline_threshold_mins: 60, use_test_email: 0, smtp_host: "", smtp_port: 587, smtp_user: "", smtp_pass: "", smtp_from: "", realtime_interval_secs: 60,
   ...(alertSettingsRaw || {})
 };
 alertSettings.realtime_cache_secs = normalizeRealtimeCacheSeconds(alertSettings.realtime_cache_secs);
 alertSettings.realtime_interval_secs = normalizeRealtimeInterval(alertSettings.realtime_interval_secs, true);

 const siteStats=getSiteStats();
 const permittedSegments=needSegments?await downloadSegments(m):[];
 const segmentIds=new Set(permittedSegments.map((segment:any)=>segment.segment_id));
 const visibleLocations=isAdmin?locations:locations.filter((location:any)=>segmentIds.has(String(location.id)));
 const visibleNames=new Set(visibleLocations.map((location:any)=>String(location.maintainer||"").trim()).filter(Boolean));
 const visibleMaintainers=isAdmin?maintainers:maintainers.filter((person:any)=>String(person.email||"").toLowerCase()===m.email.toLowerCase()||visibleNames.has(String(person.name||"").trim())).map((person:any)=>({name:person.name,english_name:person.english_name||"",email:person.email}));
 return Response.json({
   scope, isMaintainer:navMaintainer,
   summary:isAdmin?{devices:(await db().prepare('SELECT COUNT(*) n FROM devices').first())?.n||0,members:(await db().prepare("SELECT COUNT(*) n FROM members WHERE active=1 AND role='member'").first())?.n||0,grants:(await db().prepare('SELECT COUNT(*) n FROM grants').first())?.n||0}:null,
   me:{alert_email_enabled:((await db().prepare("SELECT alert_email_enabled FROM members WHERE email=?").bind(m.email).first()) as any)?.alert_email_enabled ?? 1,email:m.email,name:m.name,role:m.role,allowMaintainerNameMatch:m.allowMaintainerNameMatch,login_count:m.login_count||0,last_login_at:m.last_login_at||null,...(await db().prepare("SELECT * FROM member_profiles WHERE email=?").bind(m.email).first()||{})},
   devices,downloadSegments:permittedSegments,members,grants,locations:visibleLocations,tokens,files,fileGrants,
   labs,maintainers:visibleMaintainers,alertSettings:isAdmin?alertSettings:{realtime_interval_secs:alertSettings.realtime_interval_secs},alertChecks,alertLogs,grantRequests,totalLogins,siteStats,
   connected:!!(config().url&&config().token)
 },{headers:{"Cache-Control":"no-store"}});
}catch(e){return fail(e)}}

export async function POST(r:Request){try{
 writeGuard(r);const me=await identity(r);const isAdmin=me.role==="admin";const p=await r.json() as Record<string,unknown>;if(!p||typeof p!=="object"||Array.isArray(p))throw new AppError(400,"請提供正確的表單資料。");
 const requireAdmin=()=>{if(!isAdmin)throw new AppError(403,"權限不足。")};
  if(p.action==="alertEmailPreference"){
    const email=p.email===undefined?me.email:required(p.email,254).toLowerCase();
    if(!isAdmin&&email.toLowerCase()!==me.email.toLowerCase())throw new AppError(403,"只能修改自己的告警收信設定。");
    if(typeof p.enabled!=="boolean")throw new AppError(400,"請提供正確的收信設定。");
    const member=await db().prepare("SELECT email FROM members WHERE lower(email)=?").bind(email.toLowerCase()).first();
    if(!member)throw new AppError(404,"找不到會員。");
    await db().prepare("UPDATE members SET alert_email_enabled=? WHERE email=?").bind(p.enabled?1:0,member.email).run();
  }else if(p.action==="memberReview"){
    requireAdmin();const email=required(p.email,254).toLowerCase();
    reviewRegistration(getConnection(),email,String(p.decision),me.email,String(p.note||""));
    let notice="";
    try{await registrationMailer().review(email,p.decision==="approve");}
    catch{notice="審核結果已儲存，但通知信未寄出；請檢查 SMTP 設定 / Review saved, but the notification email could not be sent. Check SMTP settings.";}
    return Response.json({ok:true,notice},{headers:{"Cache-Control":"no-store"}});
  }else if(p.action==="profileUpdate"){
    saveProfile(getConnection(),me.email,validateProfile(p,false));
  }else if(p.action==="tokenCreate"){const token="aslung_"+crypto.randomBytes(24).toString("hex");await db().prepare("INSERT INTO api_tokens(id,email,created_at) VALUES(?,?,?)").bind(token,me.email,new Date().toISOString()).run();}else if(p.action==="tokenDelete"){await db().prepare("DELETE FROM api_tokens WHERE id=? AND email=?").bind(String(p.id),me.email).run();}else if(p.action==="device"){requireAdmin();const id=required(p.id,80);if(!/^[A-Za-z0-9_-]+$/.test(id))throw new AppError(400,"ASLUNG ID 只能使用英文、數字、底線與連字號。");const status=p.status?String(p.status):"DEPLOYED";await db().prepare("INSERT INTO devices(id,name,location,description,status) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET description=excluded.description, status=excluded.status").bind(id,"","",String(p.description??"").slice(0,1000),status).run();const labId=String(p.labId||"").trim();const currentLoc=await db().prepare("SELECT id, lab_id FROM device_locations WHERE aslung_id=? AND active=1").bind(id).first();if(status==="STANDBY"||status==="MAINTENANCE"||status==="RETIRED"||status==="LOST"){if(currentLoc){const now=new Date().toISOString();await db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE id=?").bind(now,currentLoc.id).run();}}else if(labId){if(!currentLoc||currentLoc.lab_id!==labId){const now=new Date().toISOString();if(currentLoc)await db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE id=?").bind(now,currentLoc.id).run();await db().prepare("INSERT INTO device_locations(lab_id,aslung_id,start_time,active) VALUES(?,?,?,1)").bind(labId,id,now).run();}}else if(currentLoc){const now=new Date().toISOString();await db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE id=?").bind(now,currentLoc.id).run();}await syncDeviceStatusesAndLocations();}else if(p.action==="deviceStatus"){requireAdmin();const id=required(p.id);const status=String(p.status||"STANDBY");if(status==="STANDBY"||status==="MAINTENANCE"||status==="RETIRED"||status==="LOST"){const now=new Date().toISOString();await db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE aslung_id=? AND active=1").bind(now,id).run();}await db().prepare("UPDATE devices SET status=? WHERE id=?").bind(status,id).run();await syncDeviceStatusesAndLocations();}
  else if(p.action==="deviceImport"){requireAdmin();const devices=p.devices;if(!Array.isArray(devices))throw new AppError(400,"參數錯誤");const insertDevice=db().prepare("INSERT INTO devices(id,name,location,description,status) VALUES(?,?,?,?,'STANDBY') ON CONFLICT(id) DO NOTHING");const checkLoc=db().prepare("SELECT id, lab_id FROM device_locations WHERE aslung_id=? AND active=1").bind("");const endLoc=db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE id=?");const insertLoc=db().prepare("INSERT INTO device_locations(lab_id,aslung_id,start_time,active) VALUES(?,?,?,1)");for(const d of devices){const id=typeof d==="string"?d:d.id;const labId=(d.labId||"").trim();if(typeof id==="string"&&/^[A-Za-z0-9_-]+$/.test(id)){insertDevice.bind(id,"","","").run();if(labId){const currentLoc=await db().prepare("SELECT id, lab_id FROM device_locations WHERE aslung_id=? AND active=1").bind(id).first();if(!currentLoc||currentLoc.lab_id!==labId){const now=new Date().toISOString();if(currentLoc)endLoc.bind(now,currentLoc.id).run();insertLoc.bind(labId,id,now).run();}}}}await syncDeviceStatusesAndLocations();} else if(p.action==="deviceDelete"){requireAdmin();deleteDevicesWithHistoryProtection([required(p.id)]);} else if(p.action==="deviceDeleteBulk"){requireAdmin();const ids=((p.ids||p.aslungIds)??[]) as unknown[];if(!Array.isArray(ids)||ids.length===0)throw new AppError(400,"請選擇要刪除的設備。");deleteDevicesWithHistoryProtection(ids.map(String));}
 else if(p.action==="member"){
 requireAdmin();
 const nickname = typeof p.nickname === "string" && p.nickname.trim() ? p.nickname.trim() : null;
 if (!nickname) throw new AppError(400, "請輸入會員帳號 (暱稱)。");
 if (!/^[A-Za-z0-9_\-]+$/.test(nickname)) throw new AppError(400, "暱稱僅能包含英數、底線與連字號。");
 
 let email = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
 if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, "Email 格式不正確。");
 if (!email) {
   email = nickname.toLowerCase() + "_" + crypto.randomUUID().substring(0,8) + "@local.aslung";
 }
 
 if(!validPassword(p.password)) throw new AppError(400,"初始密碼需為 12 至 128 個字元。");
 const hash = await hashPassword(p.password);
 const profile = validateProfile(p,false);
 
 await db().prepare("BEGIN IMMEDIATE").run();
 try {
   await db().prepare("INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,'member',1,?)").bind(email,crypto.randomUUID(),required(p.name),nickname,hash).run();
   saveProfile(getConnection(),email,profile);
   await db().prepare("COMMIT").run();
 } catch(e) {
   await db().prepare("ROLLBACK").run();
   if (String(e).includes("UNIQUE constraint failed: members.nickname")) {
     throw new AppError(400, "此帳號 (暱稱) 已被使用，請更換一個。");
   }
   throw e;
 }
}
 else if(p.action==="memberEdit"){
 requireAdmin();
 const originalEmail = required(p.originalEmail).toLowerCase();
 const nickname = typeof p.nickname === "string" && p.nickname.trim() ? p.nickname.trim() : null;
 if (!nickname) throw new AppError(400, "請輸入會員帳號 (暱稱)。");
 if (!/^[A-Za-z0-9_\-]+$/.test(nickname)) throw new AppError(400, "暱稱僅能包含英數、底線與連字號。");
 
 let newEmail = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
 if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) throw new AppError(400, "Email 格式不正確。");
 if (!newEmail) {
   if (originalEmail.endsWith("@local.aslung")) {
     newEmail = originalEmail; // keep the same generated email
   } else {
     newEmail = nickname.toLowerCase() + "_" + crypto.randomUUID().substring(0,8) + "@local.aslung";
   }
 }

 const name = required(p.name);
 const profile=validateProfile(p,false);
 
 let hash = null;
 if (p.password) {
   if(!validPassword(p.password)) throw new AppError(400,"密碼需為 12 至 128 個字元。");
   hash = await hashPassword(p.password);
 }
 
 try {
   await db().prepare("BEGIN").run(); await db().prepare("PRAGMA defer_foreign_keys=ON").run();
   
   if (hash) {
     await db().prepare("UPDATE members SET name=?, nickname=?, password_hash=? WHERE email=?").bind(name, nickname, hash, originalEmail).run();
   } else {
     await db().prepare("UPDATE members SET name=?, nickname=? WHERE email=?").bind(name, nickname, originalEmail).run();
   }

   if (newEmail !== originalEmail) {
     await db().prepare("UPDATE members SET email=? WHERE email=?").bind(newEmail, originalEmail).run();
     await db().prepare("UPDATE grants SET email=? WHERE email=?").bind(newEmail, originalEmail).run();
     await db().prepare("UPDATE sessions SET email=? WHERE email=?").bind(newEmail, originalEmail).run();
     await db().prepare("UPDATE api_tokens SET email=? WHERE email=?").bind(newEmail, originalEmail).run();
     await db().prepare("UPDATE file_grants SET email=? WHERE email=?").bind(newEmail, originalEmail).run();
   }
   if(typeof p.country==="string")saveProfile(getConnection(),newEmail,profile);
   if(newEmail!==originalEmail){
     await db().prepare("UPDATE member_profiles SET email_verified_at=NULL,registration_status='pending_email',reviewed_at=NULL,reviewed_by=NULL,review_note='' WHERE email=? AND registration_status!='approved'").bind(newEmail).run();
     await db().prepare("DELETE FROM email_verifications WHERE email=?").bind(newEmail).run();
   }
   await db().prepare("COMMIT").run();
 } catch(e) {
   await db().prepare("ROLLBACK").run();
   if (String(e).includes("UNIQUE constraint failed: members.nickname")) {
     throw new AppError(400, "此帳號 (暱稱) 已被使用，請更換一個。");
   }
   if (String(e).includes("UNIQUE constraint failed: members.email")) {
     throw new AppError(400, "此 Email 已被使用，請更換一個。");
   }
   throw e;
 }
}
 else if(p.action==="memberRole"){
   requireAdmin();const email=required(p.email).toLowerCase();
   const {saveMemberAccess,AccessError}=await import("@/lib/member-access.mjs");
   try{saveMemberAccess(getConnection(),me,{email,role:p.role,device_ids:[]});}catch(e){if(e instanceof AccessError)throw new AppError(e.status,e.message);throw e;}
 }
 else if(p.action==="memberStatus"){requireAdmin();const email=required(p.email);if(email===me.email)throw new AppError(400,"無法停用自己的帳號。");const application:any=await db().prepare("SELECT registration_status FROM member_profiles WHERE email=?").bind(email).first();if(p.active&&application&&application.registration_status!=="approved")throw new AppError(400,"請從註冊申請清單審核，並先完成 Email 驗證。");await db().prepare("UPDATE members SET active=? WHERE email=?").bind(p.active?1:0,email).run();}
 else if(p.action==="memberDelete"){
  requireAdmin();
  const email=required(p.email);
  if(email===me.email)throw new AppError(400,"無法刪除目前登入的管理員帳號。");
  const target: any = await db().prepare("SELECT role FROM members WHERE email=?").bind(email).first();
  if(!target)throw new AppError(404,"找不到此會員帳號。");
  if(target.role==="admin"){
    const adminCount=(await db().prepare("SELECT COUNT(*) as count FROM members WHERE role='admin'").first())?.count||0;
    if(adminCount<=1)throw new AppError(400,"系統必須至少保留一位管理員，無法刪除最後一位管理員。");
  }
  await db().prepare("BEGIN").run();
  try{
    await db().prepare("DELETE FROM login_attempts WHERE email=?").bind(email).run();
    await db().prepare("DELETE FROM members WHERE email=?").bind(email).run();
    await db().prepare("COMMIT").run();
  }catch(e){
    await db().prepare("ROLLBACK").run();
    throw e;
  }
 }
 else if(p.action==="memberDeleteBulk"){
  requireAdmin();
  const emails=((p.emails||p.memberEmails)??[]) as string[];
  if(!Array.isArray(emails)||emails.length===0)throw new AppError(400,"請選擇要刪除的會員。");
  const filteredEmails=emails.filter(e=>e!==me.email);
  if(filteredEmails.length===0)throw new AppError(400,"無法刪除目前登入的管理員帳號。");
  await db().prepare("BEGIN").run();
  try{
    for(const email of filteredEmails){
      await db().prepare("DELETE FROM login_attempts WHERE email=?").bind(email).run();
      await db().prepare("DELETE FROM members WHERE email=?").bind(email).run();
    }
    await db().prepare("COMMIT").run();
  }catch(e){
    await db().prepare("ROLLBACK").run();
    throw e;
  }
 }
 else if(p.action==="grantBulk"){
  requireAdmin();
  const {createBulkGrants,DataGrantError}=await import("@/lib/data-grants.mjs");
  try{
    const result=createBulkGrants(getConnection(),me,{grantType:p.grantType,targets:p.targets,email:p.email,start:instant(p.start),end:p.end?instant(p.end):null});
    return Response.json({ok:true,...result});
  }catch(e){if(e instanceof DataGrantError)throw new AppError(e.status,e.message);throw e;}
 }
 else if(p.action==="grant"){
  requireAdmin();
  const grant_type = p.grantType === "lab" ? "lab" : "device";
  const email = required(p.email);
  const start = instant(p.start);
  const end = p.end ? instant(p.end) : null;
  if(end && start > end) throw new AppError(400, "結束時間必須晚於開始時間。");
  if(grant_type === "lab"){
    const lab_id = required(p.labId);
    if(p.id){
      await db().prepare("UPDATE grants SET grant_type='lab', lab_id=?, device_id=NULL, email=?, start=?, end=? WHERE id=?").bind(lab_id,email,start,end,p.id).run();
    }else{
      await db().prepare("INSERT INTO grants(grant_type, lab_id, device_id, email, start, end) VALUES('lab',?,NULL,?,?,?)").bind(lab_id,email,start,end).run();
    }
  }else{
    const device_id = required(p.deviceId);
    if(p.id){
      await db().prepare("UPDATE grants SET grant_type='device', device_id=?, lab_id=NULL, email=?, start=?, end=? WHERE id=?").bind(device_id,email,start,end,p.id).run();
    }else{
      await db().prepare("INSERT INTO grants(grant_type, device_id, lab_id, email, start, end) VALUES('device',?,NULL,?,?,?)").bind(device_id,email,start,end).run();
    }
  }
}
 else if(p.action==="revoke"){requireAdmin();await db().prepare("DELETE FROM grants WHERE id=?").bind(required(p.id)).run();}
 else if(p.action==="transfer"){requireAdmin();const aslungId=required(p.aslungId),labId=required(p.labId),startTime=p.startTime?instant(p.startTime):new Date().toISOString();await db().prepare("BEGIN").run();try{await db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE aslung_id=? AND active=1").bind(startTime,aslungId).run();await db().prepare("INSERT INTO device_locations(lab_id,aslung_id,start_time,active) VALUES(?,?,?,1)").bind(labId,aslungId,startTime).run();await db().prepare("UPDATE devices SET location=? WHERE id=?").bind(labId,aslungId).run();await db().prepare("COMMIT").run();}catch(e){await db().prepare("ROLLBACK").run();throw e;}await syncDeviceStatusesAndLocations();}
 else if(p.action==="transferBulk"){requireAdmin();const aslungIds=p.aslungIds as string[],labId=required(p.labId),startTime=new Date().toISOString();if(!Array.isArray(aslungIds)||!aslungIds.length)throw new AppError(400,"請選擇要移轉的設備。");await db().prepare("BEGIN").run();try{for(const id of aslungIds){await db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE aslung_id=? AND active=1").bind(startTime,id).run();await db().prepare("INSERT INTO device_locations(lab_id,aslung_id,start_time,active) VALUES(?,?,?,1)").bind(labId,id,startTime).run();await db().prepare("UPDATE devices SET location=? WHERE id=?").bind(labId,id).run();}await db().prepare("COMMIT").run();}catch(e){await db().prepare("ROLLBACK").run();throw e;}await syncDeviceStatusesAndLocations();}
 else if(p.action==="endGrants"){requireAdmin();const aslungId=required(p.aslungId),now=new Date().toISOString();await db().prepare("UPDATE grants SET end=? WHERE device_id=? AND (end IS NULL OR end>?)").bind(now,aslungId,now).run();}
 else if(p.action==="locationAdd"){requireAdmin();const labId=required(p.labId),aslungId=required(p.aslungId),maintainer=p.maintainer?String(p.maintainer).trim():null,startTime=instant(p.startTime),endTime=p.endTime?instant(p.endTime):null,active=p.active?1:0;await db().prepare("INSERT INTO device_locations(lab_id,aslung_id,maintainer,start_time,end_time,active) VALUES(?,?,?,?,?,?)").bind(labId,aslungId,maintainer,startTime,endTime,active).run();await syncDeviceStatusesAndLocations();}
 else if(p.action==="locationUpdate"){requireAdmin();const id=required(p.id),labId=required(p.labId),aslungId=required(p.aslungId),maintainer=p.maintainer?String(p.maintainer).trim():null,startTime=instant(p.startTime),endTime=p.endTime?instant(p.endTime):null,active=p.active?1:0;await db().prepare("UPDATE device_locations SET lab_id=?, aslung_id=?, maintainer=?, start_time=?, end_time=?, active=? WHERE id=?").bind(labId,aslungId,maintainer,startTime,endTime,active,id).run();await syncDeviceStatusesAndLocations();}
 else if(p.action==="locationDelete"){requireAdmin();await db().prepare("DELETE FROM device_locations WHERE id=?").bind(required(p.id)).run();await syncDeviceStatusesAndLocations();}
 else if(p.action==="locationDeleteBulk"){requireAdmin();const ids=((p.ids||p.locationIds)??[]) as unknown[];if(!Array.isArray(ids)||ids.length===0)throw new AppError(400,"請選擇要刪除的位置紀錄。");await db().prepare("BEGIN").run();try{for(const id of ids){await db().prepare("DELETE FROM device_locations WHERE id=?").bind(Number(id)).run();}await db().prepare("COMMIT").run();}catch(e){await db().prepare("ROLLBACK").run();throw e;}await syncDeviceStatusesAndLocations();}
 else if(p.action==="locationImport"){
  requireAdmin();
  const records = p.records as any[];
  if(!Array.isArray(records)||!records.length)throw new AppError(400,"無有效紀錄可匯入。");
  await db().prepare("BEGIN").run();
  try{
    const insertDev=db().prepare("INSERT INTO devices(id,name,location,description,status) VALUES(?,?,?,?,'STANDBY') ON CONFLICT(id) DO NOTHING");
    const checkExist=db().prepare("SELECT id FROM device_locations WHERE lab_id=? AND aslung_id=? AND start_time=?");
    const updateLoc=db().prepare("UPDATE device_locations SET maintainer=?, end_time=?, active=? WHERE id=?");
    const insertLoc=db().prepare("INSERT INTO device_locations(lab_id,aslung_id,maintainer,start_time,end_time,active) VALUES(?,?,?,?,?,?)");
    for(const r of records){
      const labId=String(r.lab_id||"").trim(), aslungId=String(r.aslung_id||"").trim(), startTime=String(r.start_time||"").trim();
      if(!labId||!aslungId||!startTime)continue;
      const endTime=r.end_time?String(r.end_time).trim():null, maintainer=r.maintainer?String(r.maintainer).trim():null, active=r.active?1:0;
      await insertDev.bind(aslungId,"","","").run();
      const ex=await checkExist.bind(labId,aslungId,startTime).first();
      if(ex)await updateLoc.bind(maintainer,endTime,active,ex.id).run();
      else await insertLoc.bind(labId,aslungId,maintainer,startTime,endTime,active).run();
    }
    await db().prepare("COMMIT").run();
  }catch(e){await db().prepare("ROLLBACK").run();throw e;}
  await syncDeviceStatusesAndLocations();
} else if(p.action==="locationSyncGoogle"){
  requireAdmin();
  let url=typeof p.url==="string"&&p.url.trim()?p.url.trim():"https://docs.google.com/spreadsheets/d/1Vzaz14hHco2u8nmjoKBqDC12k-OX6lMjyrP_UhAhZrI/export?format=csv&gid=140603820#gid=140603820";
  const mid=url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const mgid=url.match(/gid=([0-9]+)/);
  if(mid){
    url=`https://docs.google.com/spreadsheets/d/${mid[1]}/export?format=csv`+(mgid?`&gid=${mgid[1]}`:"");
  }
  const onlyAslung=p.onlyAslung!==false;
  const res=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!res.ok)throw new AppError(500,`無法從 Google 試算表下載資料 (HTTP ${res.status})`);
  const csvText=await res.text();
  const rows=parseCsvRows(csvText);
  if(rows.length<=1)throw new AppError(400,"Google 試算表內容為空。");
  const headers=rows[0].map(h=>h.trim().toLowerCase());
  const labIdx=headers.indexOf("lab_id"), mainIdx=headers.indexOf("maintainer"), typeIdx=headers.indexOf("device_type"), devIdx=headers.indexOf("device_id"), startIdx=headers.indexOf("start_date"), endIdx=headers.indexOf("end_date"), actIdx=headers.indexOf("active");
  if(labIdx===-1||devIdx===-1||startIdx===-1)throw new AppError(400,"試算表欄位名稱不符，需包含 lab_id, device_id, start_date。");
  const records:any[]=[];
  for(let i=1;i<rows.length;i++){
    const cols=rows[i];
    const labId=labIdx!==-1&&cols[labIdx]?cols[labIdx].trim():"";
    const devType=(typeIdx!==-1&&cols[typeIdx]?cols[typeIdx].trim():"")||"";
    const devId=devIdx!==-1&&cols[devIdx]?cols[devIdx].trim():"";
    const sDate=startIdx!==-1&&cols[startIdx]?cols[startIdx].trim():"";
    const eDate=endIdx!==-1&&cols[endIdx]&&cols[endIdx].trim()?cols[endIdx].trim():null;
    const actVal=(actIdx!==-1&&cols[actIdx]?cols[actIdx].trim():"")||"";
    const maintainer=(mainIdx!==-1&&cols[mainIdx]?cols[mainIdx].trim():"")||"";
    if(!labId||!devId||!sDate)continue;
    if(onlyAslung&&(!devType||devType.toLowerCase()!=="aslung"))continue;
    const normalizeDate=(dStr:string|null,isEnd=false)=>{if(!dStr)return null;const m=dStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);if(m){const y=m[1],mo=m[2].padStart(2,"0"),d=m[3].padStart(2,"0");return new Date(y+"-"+mo+"-"+d+(isEnd?"T23:59:59+08:00":"T00:00:00+08:00")).toISOString();}const p=new Date(dStr);return isNaN(p.getTime())?null:p.toISOString();};
    const startTimeIso=normalizeDate(sDate,false);
    if(!startTimeIso)continue;
    const endTimeIso=normalizeDate(eDate,true);
    const isActive=(!eDate&&actVal.toUpperCase()!=="N")||actVal.toUpperCase()==="Y"?1:0;
    records.push({lab_id:labId,maintainer,aslung_id:devId,start_time:startTimeIso,end_time:endTimeIso,active:isActive});
  }
  if(!records.length)throw new AppError(400,"未解析到符合條件的設備紀錄。");
  await db().prepare("BEGIN").run();
  try{
    const insertDev=db().prepare("INSERT INTO devices(id,name,location,description,status) VALUES(?,?,?,?,'STANDBY') ON CONFLICT(id) DO NOTHING");
    const checkExist=db().prepare("SELECT id FROM device_locations WHERE lab_id=? AND aslung_id=? AND start_time=?");
    const updateLoc=db().prepare("UPDATE device_locations SET maintainer=?, end_time=?, active=? WHERE id=?");
    const insertLoc=db().prepare("INSERT INTO device_locations(lab_id,aslung_id,maintainer,start_time,end_time,active) VALUES(?,?,?,?,?,?)");
    for(const r of records){
      await insertDev.bind(r.aslung_id,"","","").run();
      const ex=await checkExist.bind(r.lab_id,r.aslung_id,r.start_time).first();
      if(ex)await updateLoc.bind(r.maintainer,r.end_time,r.active,ex.id).run();
      else await insertLoc.bind(r.lab_id,r.aslung_id,r.maintainer,r.start_time,r.end_time,r.active).run();
    }
    await db().prepare("COMMIT").run();
  }catch(e){await db().prepare("ROLLBACK").run();throw e;}
  await syncDeviceStatusesAndLocations();
  return Response.json({ok:true,synced:records.length});
} else if(p.action==="lab"){
  requireAdmin();
  const id=required(p.id,80);
  const cityName=String(p.city_name||"").trim();
  const townName=String(p.town_name||"").trim();
  const locationName=String(p.location_name||"").trim();
  const lat=p.lat ? Number(p.lat) : null;
  const lon=p.lon ? Number(p.lon) : null;
  const description=String(p.description||"").trim();
  const height=String(p.height||"").trim();
  const source=String(p.source||"").trim();
  const command=String(p.command||"").trim();
  const now=new Date().toISOString();
  await db().prepare(`
    INSERT INTO labs(id,city_name,town_name,location_name,lat,lon,description,height,source,command,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      city_name=excluded.city_name, town_name=excluded.town_name, location_name=excluded.location_name,
      lat=excluded.lat, lon=excluded.lon, description=excluded.description, height=excluded.height,
      source=excluded.source, command=excluded.command
  `).bind(id,cityName,townName,locationName,lat,lon,description,height,source,command,now).run();
} else if(p.action==="labDelete"){
  requireAdmin();
  const id=required(p.id);
  await db().prepare("DELETE FROM labs WHERE id=?").bind(id).run();
} else if(p.action==="labDeleteBulk"){
  requireAdmin();
  const ids=((p.ids||p.labIds)??[]) as unknown[];
  if(!Array.isArray(ids)||ids.length===0)throw new AppError(400,"請選擇要刪除的地點。");
  await db().prepare("BEGIN").run();
  try{
    for(const id of ids){
      await db().prepare("DELETE FROM labs WHERE id=?").bind(String(id)).run();
    }
    await db().prepare("COMMIT").run();
  }catch(e){await db().prepare("ROLLBACK").run();throw e;}
} else if(p.action==="labSyncGoogle"){
  requireAdmin();
  let url=typeof p.url==="string"&&p.url.trim()?p.url.trim():"https://docs.google.com/spreadsheets/d/1Vzaz14hHco2u8nmjoKBqDC12k-OX6lMjyrP_UhAhZrI/edit?gid=1071144150#gid=1071144150";
  const mid=url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const mgid=url.match(/gid=([0-9]+)/);
  if(mid){
    url=`https://docs.google.com/spreadsheets/d/${mid[1]}/export?format=csv`+(mgid?`&gid=${mgid[1]}`:"");
  }
  const res=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!res.ok)throw new AppError(500,`無法從 Google 試算表下載地點資料 (HTTP ${res.status})`);
  const csvText=await res.text();
  const rows=parseCsvRows(csvText);
  if(rows.length<=1)throw new AppError(400,"試算表內容為空。");
  const headers=rows[0].map(h=>h.trim().toLowerCase());
  const idIdx=headers.indexOf("lab_id"), cityIdx=headers.indexOf("city_name"), townIdx=headers.indexOf("town_name"), locIdx=headers.indexOf("location_name"), latIdx=headers.indexOf("lat"), lonIdx=headers.indexOf("lon"), descIdx=headers.indexOf("description"), heightIdx=headers.indexOf("height"), srcIdx=headers.indexOf("source"), cmdIdx=headers.indexOf("command");
  if(idIdx===-1)throw new AppError(400,"試算表需包含 lab_id 欄位。");
  const now=new Date().toISOString();
  await db().prepare("BEGIN").run();
  let syncedCount=0;
  try{
    // Clean up any previously corrupted lab records with line breaks or abnormal IDs
    await db().prepare("DELETE FROM labs WHERE id LIKE '%\n%' OR id LIKE '%\r%' OR id LIKE 'V_D%' OR id LIKE 'V_SG%' OR LENGTH(id) > 50").run();
    const upsert=db().prepare(`
      INSERT INTO labs(id,city_name,town_name,location_name,lat,lon,description,height,source,command,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        city_name=excluded.city_name, town_name=excluded.town_name, location_name=excluded.location_name,
        lat=excluded.lat, lon=excluded.lon, description=excluded.description, height=excluded.height,
        source=excluded.source, command=excluded.command
    `);
    for(let i=1;i<rows.length;i++){
      const cols=rows[i];
      const id=idIdx!==-1&&cols[idIdx]?cols[idIdx].trim():"";
      if(!id || id.length > 50 || id.includes("\n") || id.includes("\r"))continue;
      const city=(cityIdx!==-1&&cols[cityIdx]?cols[cityIdx].trim():"")||"";
      const town=(townIdx!==-1&&cols[townIdx]?cols[townIdx].trim():"")||"";
      const locName=(locIdx!==-1&&cols[locIdx]?cols[locIdx].trim():"")||"";
      const rawLat=latIdx!==-1&&cols[latIdx]?cols[latIdx].trim():"";
      const lat=rawLat?parseFloat(rawLat):null;
      const rawLon=lonIdx!==-1&&cols[lonIdx]?cols[lonIdx].trim():"";
      const lon=rawLon?parseFloat(rawLon):null;
      const desc=(descIdx!==-1&&cols[descIdx]?cols[descIdx].trim():"")||"";
      const height=(heightIdx!==-1&&cols[heightIdx]?cols[heightIdx].trim():"")||"";
      const src=(srcIdx!==-1&&cols[srcIdx]?cols[srcIdx].trim():"")||"";
      const cmd=(cmdIdx!==-1&&cols[cmdIdx]?cols[cmdIdx].trim():"")||"";
      await upsert.bind(id,city,town,locName,isNaN(lat as number)?null:lat,isNaN(lon as number)?null:lon,desc,height,src,cmd,now).run();
      syncedCount++;
    }
    await db().prepare("COMMIT").run();
  }catch(e){await db().prepare("ROLLBACK").run();throw e;}
  return Response.json({ok:true,synced:syncedCount});
} else if(p.action==="maintainer"){
  requireAdmin();
  const name=required(p.name,80);
  const email=required(p.email,160);
  const englishName=p.english_name===undefined?null:(p.english_name===""?"":required(p.english_name,160));
  const emailTest=String(p.email_test||"").trim();
  const phone=String(p.phone||"").trim();
  const notes=String(p.notes||"").trim();
  const now=new Date().toISOString();
  await db().prepare(`
    INSERT INTO maintainers(name,email,email_test,phone,notes,created_at,english_name)
    VALUES(?,?,?,?,?,?,COALESCE(?,''))
    ON CONFLICT(name) DO UPDATE SET
      email=excluded.email, email_test=excluded.email_test, phone=excluded.phone, notes=excluded.notes,
      english_name=CASE WHEN ? THEN excluded.english_name ELSE maintainers.english_name END
  `).bind(name,email,emailTest,phone,notes,now,englishName,englishName!==null?1:0).run();
} else if(p.action==="maintainerDelete"){
  requireAdmin();
  const name=required(p.name);
  await db().prepare("DELETE FROM maintainers WHERE name=?").bind(name).run();
} else if(p.action==="maintainerDeleteBulk"){
  requireAdmin();
  const names=((p.names||p.maintainerNames)??[]) as unknown[];
  if(!Array.isArray(names)||names.length===0)throw new AppError(400,"請選擇要刪除的維護人員。");
  await db().prepare("BEGIN").run();
  try{
    for(const n of names){
      await db().prepare("DELETE FROM maintainers WHERE name=?").bind(String(n)).run();
    }
    await db().prepare("COMMIT").run();
  }catch(e){await db().prepare("ROLLBACK").run();throw e;}
} else if(p.action==="maintainerSyncGoogle"){
  requireAdmin();
  let url=typeof p.url==="string"&&p.url.trim()?p.url.trim():"https://docs.google.com/spreadsheets/d/1Vzaz14hHco2u8nmjoKBqDC12k-OX6lMjyrP_UhAhZrI/export?format=csv&gid=603688252#gid=603688252";
  const mid=url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const mgid=url.match(/gid=([0-9]+)/);
  if(mid){
    url=`https://docs.google.com/spreadsheets/d/${mid[1]}/export?format=csv`+(mgid?`&gid=${mgid[1]}`:"");
  }
  const res=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"}});
  if(!res.ok)throw new AppError(500,`無法從 Google 試算表下載維護人員資料 (HTTP ${res.status})`);
  const csvText=await res.text();
  const rows=parseCsvRows(csvText);
  if(rows.length<=1)throw new AppError(400,"試算表內容為空。");
  const headers=rows[0].map(h=>h.trim().toLowerCase());
  const mainIdx=headers.includes("cht_name")?headers.indexOf("cht_name"):headers.indexOf("maintainer"), mailIdx=headers.indexOf("mail"), testIdx=headers.indexOf("mail_test");
  const englishIdx=headers.includes("eng_name")?headers.indexOf("eng_name"):headers.findIndex(h=>["english_name","name_en","英文名","英文名稱","英文稱呼","英文姓名"].includes(h));
  if(mainIdx===-1||mailIdx===-1)throw new AppError(400,"試算表需包含 Cht_name（或舊版 maintainer）與 mail 欄位；英文稱呼請填 Eng_name。");
  const now=new Date().toISOString();
  await db().prepare("BEGIN").run();
  let syncedCount=0;
  try{
    const upsert=db().prepare(`
      INSERT INTO maintainers(name,email,email_test,phone,notes,created_at,english_name)
      VALUES(?,?,?,'','',?,?)
      ON CONFLICT(name) DO UPDATE SET
        email=excluded.email, email_test=excluded.email_test,
        english_name=CASE WHEN ? THEN excluded.english_name ELSE maintainers.english_name END
    `);
    for(let i=1;i<rows.length;i++){
      const cols=rows[i];
      const name=mainIdx!==-1&&cols[mainIdx]?cols[mainIdx].trim():"";
      const mail=mailIdx!==-1&&cols[mailIdx]?cols[mailIdx].trim():"";
      if(!name||!mail)continue;
      const mailTest=(testIdx!==-1&&cols[testIdx]?cols[testIdx].trim():"")||"";
      const englishName=englishIdx===-1?"":(cols[englishIdx]||"").trim();
      if(englishName.length>160)throw new AppError(400,`第 ${i+1} 列英文稱呼超過 160 字。`);
      await upsert.bind(name,mail,mailTest,now,englishName,englishIdx===-1?0:1).run();
      syncedCount++;
    }
    await db().prepare("COMMIT").run();
  }catch(e){await db().prepare("ROLLBACK").run();throw e;}
  return Response.json({ok:true,synced:syncedCount});
} else if(p.action==="alertCheckNow"){
  requireAdmin();
  const { checkAndSendOfflineAlerts } = await import("@/lib/alerts");
  const result = await checkAndSendOfflineAlerts({ force: true });
  return Response.json({ok:true,result});
} else if(p.action==="cronCheck"){
  const { checkAndSendOfflineAlerts } = await import("@/lib/alerts");
  const result = await checkAndSendOfflineAlerts({ force: false });
  return Response.json({ok:true,result});
} else if(p.action==="alertSettingsUpdate" || p.action==="alertSettings"){
  requireAdmin();
  const enabled=p.enabled?1:0;
  const scheduleType=["interval","daily","weekly"].includes(String(p.schedule_type))?String(p.schedule_type):"interval";
  const scheduleTime=String(p.schedule_time||"09:00").trim()||"09:00";
  const scheduleDays=String(p.schedule_days||"1,2,3,4,5").trim()||"1,2,3,4,5";
  const checkInterval=Math.max(5,Number(p.check_interval_mins)||60);
  const offlineThreshold=Math.max(5,Number(p.offline_threshold_mins)||60);
  const useTestEmail=p.use_test_email?1:0;
  const smtpHost=String(p.smtp_host||"").trim();
  const smtpPort=Number(p.smtp_port)||587;
  const smtpUser=String(p.smtp_user||"").trim();
  const smtpPass=p.smtp_pass?String(p.smtp_pass):"";
  const smtpFrom=String(p.smtp_from||"").trim();
  if(smtpPass){
    await db().prepare(`
      UPDATE alert_settings
      SET enabled=?, schedule_type=?, schedule_time=?, schedule_days=?,
          check_interval_mins=?, offline_threshold_mins=?, use_test_email=?,
          smtp_host=?, smtp_port=?, smtp_user=?, smtp_pass=?, smtp_from=?
      WHERE id=1
    `).bind(enabled,scheduleType,scheduleTime,scheduleDays,checkInterval,offlineThreshold,useTestEmail,smtpHost,smtpPort,smtpUser,smtpPass,smtpFrom).run();
  } else {
    await db().prepare(`
      UPDATE alert_settings
      SET enabled=?, schedule_type=?, schedule_time=?, schedule_days=?,
          check_interval_mins=?, offline_threshold_mins=?, use_test_email=?,
          smtp_host=?, smtp_port=?, smtp_user=?, smtp_from=?
      WHERE id=1
    `).bind(enabled,scheduleType,scheduleTime,scheduleDays,checkInterval,offlineThreshold,useTestEmail,smtpHost,smtpPort,smtpUser,smtpFrom).run();
  }
} else if(p.action==="realtimeCacheUpdate"){
  requireAdmin();
  if(!validRealtimeCacheSeconds(p.seconds))throw new AppError(400,"共用量測快取須為 0 至 3600 的整數秒數；0 表示停用快取。");
  await db().prepare(`INSERT INTO alert_settings (id,realtime_cache_secs) VALUES (1,?)
    ON CONFLICT(id) DO UPDATE SET realtime_cache_secs=excluded.realtime_cache_secs`).bind(p.seconds).run();
  return Response.json({ok:true,realtime_cache_secs:p.seconds},{headers:{'Cache-Control':'no-store'}});
} else if(p.action==="realtimeIntervalUpdate"){
  requireAdmin();
  const secs = p.interval;
  if (typeof secs !== "number" || (secs !== 0 && !ADMIN_REALTIME_INTERVALS.includes(secs))) {
    throw new AppError(400, "請選擇 1 至 30 分鐘的更新頻率，或暫停自動更新。");
  }
  await db().prepare(`
    INSERT INTO alert_settings (id, realtime_interval_secs) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET realtime_interval_secs = excluded.realtime_interval_secs
  `).bind(secs).run();
  return Response.json({ok:true,realtime_interval_secs:secs});
} else if(p.action==="fileDelete"){
  requireAdmin();
  const fileId=required(p.id);
  const file:any=await db().prepare("SELECT * FROM files WHERE id=?").bind(fileId).first();
  if(file){
    if(!file.external_url&&file.storage_path){try{const fsMod=await import("node:fs");if(fsMod.existsSync(file.storage_path))fsMod.unlinkSync(file.storage_path);}catch{}}
    await db().prepare("DELETE FROM file_grants WHERE file_id=?").bind(fileId).run();
    await db().prepare("DELETE FROM files WHERE id=?").bind(fileId).run();
  }
} else if(p.action==="fileGrantsUpdate"){
  requireAdmin();
  const fileId=required(p.fileId);
  const emails=p.emails as string[];
  if(!Array.isArray(emails))throw new AppError(400,"成員名單格式不正確。");
  await db().prepare("BEGIN").run();
  try{
    await db().prepare("DELETE FROM file_grants WHERE file_id=?").bind(fileId).run();
    const insertGrant=db().prepare("INSERT OR IGNORE INTO file_grants (file_id, email, created_at) VALUES (?, ?, ?)");
    const now=new Date().toISOString();
    for(const em of emails){
      if(typeof em==="string"&&em.trim()){
        insertGrant.bind(fileId, em.trim().toLowerCase(), now).run();
      }
    }
    await db().prepare("COMMIT").run();
  }catch(e){await db().prepare("ROLLBACK").run();throw e;}
} else if(p.action==="alertLogDelete"){
  requireAdmin();
  const id=Number(p.id);
  if(!id)throw new AppError(400,"無效的日誌編號。");
  await db().prepare("DELETE FROM alert_logs WHERE id=?").bind(id).run();
} else if(p.action==="alertLogDeleteBulk"){
  requireAdmin();
  const ids=((p.ids||p.logIds)??[]) as unknown[];
  if(!Array.isArray(ids)||ids.length===0)throw new AppError(400,"請選擇要刪除的告警日誌。");
  await db().prepare("BEGIN").run();
  try{
    for(const id of ids){
      await db().prepare("DELETE FROM alert_logs WHERE id=?").bind(Number(id)).run();
    }
    await db().prepare("COMMIT").run();
  }catch(e){await db().prepare("ROLLBACK").run();throw e;}
} else if(p.action==="alertLogClearAll"){
  requireAdmin();
  await db().prepare("DELETE FROM alert_logs").run();
} else if(p.action==="alertCheckDelete"){
  requireAdmin();
  const checkId=Number(p.id);
  await db().prepare("DELETE FROM alert_logs WHERE check_id=?").bind(checkId).run();
  await db().prepare("DELETE FROM alert_checks WHERE id=?").bind(checkId).run();
} else if(p.action==="alertCheckDeleteBulk"){
  requireAdmin();
  const ids=((p.ids||p.checkIds)??[]) as unknown[];
  if(!Array.isArray(ids)||ids.length===0)throw new AppError(400,"請選擇要刪除的檢查日誌。");
  const ph=ids.map(()=>"?").join(",");
  await db().prepare(`DELETE FROM alert_logs WHERE check_id IN (${ph})`).bind(...ids).run();
  await db().prepare(`DELETE FROM alert_checks WHERE id IN (${ph})`).bind(...ids).run();
} else if(p.action==="alertCheckClearAll"){
  requireAdmin();
  await db().prepare("DELETE FROM alert_logs").run();
  await db().prepare("DELETE FROM alert_checks").run();
} else if(p.action==="requestGrant"){
  const reqType = p.requestType === "lab" ? "lab" : "device";
  const reason = String(p.reason||"").trim().slice(0,500);
  if(reqType === "lab"){
    const labId = required(p.labId, 80).trim();
    const lab: any = await db().prepare("SELECT id FROM labs WHERE UPPER(id)=UPPER(?)").bind(labId).first();
    if(!lab) throw new AppError(404, `找不到地點代碼為「${labId}」的地點資料。`);
    const pending = await db().prepare("SELECT id FROM grant_requests WHERE email=? AND UPPER(lab_id)=UPPER(?) AND status='PENDING'").bind(me.email, lab.id).first();
    if(pending) throw new AppError(400, "您已提出過此地點的授權申請，目前正在等待管理員審核中。");
    const existingGrant = await db().prepare("SELECT id FROM grants WHERE email=? AND UPPER(lab_id)=UPPER(?) AND grant_type='lab' AND (end IS NULL OR end>=?)").bind(me.email, lab.id, new Date().toISOString()).first();
    if(existingGrant) throw new AppError(400, "您目前已擁有此地點的有效資料授權，無須重複申請。");
    await db().prepare("INSERT INTO grant_requests(email,request_type,lab_id,aslung_id,reason,status,created_at) VALUES(?,'lab',?,'',?,'PENDING',?)").bind(me.email, lab.id, reason, new Date().toISOString()).run();
  } else {
    const aslungId = required(p.aslungId||p.aslung_id, 80).trim().toUpperCase();
    const dev: any = await db().prepare("SELECT id FROM devices WHERE UPPER(id)=UPPER(?)").bind(aslungId).first();
    if(!dev) throw new AppError(404, `找不到 ASLUNG ID 為「${aslungId}」的設備，請確認編號是否正確。`);
    const pending = await db().prepare("SELECT id FROM grant_requests WHERE email=? AND UPPER(aslung_id)=UPPER(?) AND status='PENDING'").bind(me.email, aslungId).first();
    if(pending) throw new AppError(400, "您已提出過此設備的授權申請，目前正在等待管理員審核中。");
    const existingGrant = await db().prepare("SELECT id FROM grants WHERE email=? AND UPPER(device_id)=UPPER(?) AND (grant_type='device' OR grant_type IS NULL) AND (end IS NULL OR end>=?)").bind(me.email, aslungId, new Date().toISOString()).first();
    if(existingGrant) throw new AppError(400, "您目前已擁有此設備的有效資料授權，無須重複申請。");
    await db().prepare("INSERT INTO grant_requests(email,request_type,lab_id,aslung_id,reason,status,created_at) VALUES(?,'device',NULL,?,?,'PENDING',?)").bind(me.email, dev.id, reason, new Date().toISOString()).run();
  }
} else if(p.action==="reviewGrantRequest"){
  requireAdmin();
  const reqId=Number(p.id);
  const decision=String(p.decision||"").toUpperCase();
  if(decision!=="APPROVED"&&decision!=="REJECTED")throw new AppError(400,"無效的審核結果。");
  const req:any=await db().prepare("SELECT * FROM grant_requests WHERE id=?").bind(reqId).first();
  if(!req)throw new AppError(404,"找不到此筆申請紀錄。");
  const nowIso=new Date().toISOString();
  if(decision==="APPROVED"){
    const start=p.start?instant(String(p.start)):new Date(Date.now()-365*86400000).toISOString();
    const end=p.end?instant(String(p.end)):null;
    if(req.request_type === "lab"){
      await db().prepare("INSERT INTO grants(grant_type,lab_id,device_id,email,start,end) VALUES('lab',?,NULL,?,?,?)").bind(req.lab_id,req.email,start,end).run();
    } else {
      await db().prepare("INSERT INTO grants(grant_type,device_id,lab_id,email,start,end) VALUES('device',?,NULL,?,?,?)").bind(req.aslung_id,req.email,start,end).run();
    }
  }
  await db().prepare("UPDATE grant_requests SET status=?, reviewed_by=?, reviewed_at=? WHERE id=?").bind(decision,me.email,nowIso,reqId).run();
} else if(p.action==="grantRequestDelete"){
  const reqId=Number(p.id);
  if(isAdmin){
    await db().prepare("DELETE FROM grant_requests WHERE id=?").bind(reqId).run();
  }else{
    await db().prepare("DELETE FROM grant_requests WHERE id=? AND email=?").bind(reqId,me.email).run();
  }
} else throw new AppError(400,"不支援此操作。");
 return Response.json({ok:true});
}catch(e){if(e instanceof RegistrationError)return fail(new AppError(e.status,e.message));if(e instanceof Error&&e.message.includes("UNIQUE constraint"))return Response.json({error:"此 ID 或名稱已存在。"},{status:409});return fail(e)}}
