import crypto from "node:crypto";
import {randomUUID} from "node:crypto";
import {hashPassword,validPassword} from "@/lib/passwords.mjs";
import {admin,identity,db,config,fail,writeGuard,required,instant,AppError,syncDeviceStatusesAndLocations} from "@/lib/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";

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

export async function GET(){try{
 const m=await identity();const isAdmin=m.role==="admin";
 await syncDeviceStatusesAndLocations();
 const devices=(await (isAdmin?db().prepare("SELECT * FROM devices ORDER BY id"):db().prepare("SELECT d.*,g.start,g.end FROM devices d JOIN grants g ON g.device_id=d.id WHERE g.email=? ORDER BY d.id").bind(m.email)).all()).results;
 const members=isAdmin?(await db().prepare("SELECT email,name,nickname,role,active FROM members ORDER BY role,email").all()).results:[];
 const grants=isAdmin?(await db().prepare("SELECT * FROM grants ORDER BY device_id,email,start DESC").all()).results:[];
 const locations=(await db().prepare("SELECT * FROM device_locations ORDER BY start_time DESC").all()).results;
 const tokens=(await db().prepare("SELECT id, created_at FROM api_tokens WHERE email=? ORDER BY created_at DESC").bind(m.email).all()).results;
 const files=(await (isAdmin?db().prepare("SELECT * FROM files ORDER BY created_at DESC"):db().prepare("SELECT f.* FROM files f JOIN file_grants fg ON fg.file_id=f.id WHERE fg.email=? ORDER BY f.created_at DESC").bind(m.email)).all()).results;
 const fileGrants=isAdmin?(await db().prepare("SELECT * FROM file_grants").all()).results:[];
 const labs=(await db().prepare("SELECT * FROM labs ORDER BY id").all()).results;
 const maintainers=(await db().prepare("SELECT * FROM maintainers ORDER BY name").all()).results;
 const alertSettings=(await db().prepare("SELECT * FROM alert_settings WHERE id=1").first()) || {
   id: 1, enabled: 1, check_interval_mins: 60, offline_threshold_mins: 60, use_test_email: 0, smtp_host: "", smtp_port: 587, smtp_user: "", smtp_pass: "", smtp_from: ""
 };
 const alertLogs=isAdmin?(await db().prepare("SELECT * FROM alert_logs ORDER BY created_at DESC LIMIT 200").all()).results:[];

 return Response.json({
   me:{email:m.email,name:m.name,role:m.role},
   devices,members,grants,locations,tokens,files,fileGrants,
   labs,maintainers,alertSettings,alertLogs,
   connected:!!(config().url&&config().token)
 },{headers:{"Cache-Control":"no-store"}});
}catch(e){return fail(e)}}

export async function POST(r:Request){try{
 writeGuard(r);const me=await identity(r);const isAdmin=me.role==="admin";const p=await r.json() as Record<string,unknown>;if(!p||typeof p!=="object"||Array.isArray(p))throw new AppError(400,"請提供正確的表單資料。");
 const requireAdmin=()=>{if(!isAdmin)throw new AppError(403,"權限不足。")};
  if(p.action==="tokenCreate"){const token="aslung_"+crypto.randomBytes(24).toString("hex");await db().prepare("INSERT INTO api_tokens(id,email,created_at) VALUES(?,?,?)").bind(token,me.email,new Date().toISOString()).run();}else if(p.action==="tokenDelete"){await db().prepare("DELETE FROM api_tokens WHERE id=? AND email=?").bind(String(p.id),me.email).run();}else if(p.action==="device"){requireAdmin();const id=required(p.id,80);if(!/^[A-Za-z0-9_-]+$/.test(id))throw new AppError(400,"ASLUNG ID 只能使用英文、數字、底線與連字號。");const status=p.status?String(p.status):"DEPLOYED";await db().prepare("INSERT INTO devices(id,name,location,description,status) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET description=excluded.description, status=excluded.status").bind(id,"","",String(p.description??"").slice(0,1000),status).run();const labId=String(p.labId||"").trim();const currentLoc=await db().prepare("SELECT id, lab_id FROM device_locations WHERE aslung_id=? AND active=1").bind(id).first();if(labId){if(!currentLoc||currentLoc.lab_id!==labId){const now=new Date().toISOString();if(currentLoc)await db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE id=?").bind(now,currentLoc.id).run();await db().prepare("INSERT INTO device_locations(lab_id,aslung_id,start_time,active) VALUES(?,?,?,1)").bind(labId,id,now).run();}}else if(currentLoc){const now=new Date().toISOString();await db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE id=?").bind(now,currentLoc.id).run();}await syncDeviceStatusesAndLocations();}
  else if(p.action==="deviceImport"){requireAdmin();const devices=p.devices;if(!Array.isArray(devices))throw new AppError(400,"參數錯誤");const insertDevice=db().prepare("INSERT INTO devices(id,name,location,description,status) VALUES(?,?,?,?,'STANDBY') ON CONFLICT(id) DO NOTHING");const checkLoc=db().prepare("SELECT id, lab_id FROM device_locations WHERE aslung_id=? AND active=1").bind("");const endLoc=db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE id=?");const insertLoc=db().prepare("INSERT INTO device_locations(lab_id,aslung_id,start_time,active) VALUES(?,?,?,1)");for(const d of devices){const id=typeof d==="string"?d:d.id;const labId=(d.labId||"").trim();if(typeof id==="string"&&/^[A-Za-z0-9_-]+$/.test(id)){insertDevice.bind(id,"","","").run();if(labId){const currentLoc=await db().prepare("SELECT id, lab_id FROM device_locations WHERE aslung_id=? AND active=1").bind(id).first();if(!currentLoc||currentLoc.lab_id!==labId){const now=new Date().toISOString();if(currentLoc)endLoc.bind(now,currentLoc.id).run();insertLoc.bind(labId,id,now).run();}}}}await syncDeviceStatusesAndLocations();} else if(p.action==="deviceDelete"){requireAdmin();const id=required(p.id);await db().prepare("DELETE FROM grants WHERE device_id=?").bind(id).run();await db().prepare("DELETE FROM device_locations WHERE aslung_id=?").bind(id).run();await db().prepare("DELETE FROM devices WHERE id=?").bind(id).run();} else if(p.action==="deviceDeleteBulk"){requireAdmin();const ids=((p.ids||p.aslungIds)??[]) as unknown[];if(!Array.isArray(ids)||ids.length===0)throw new AppError(400,"請選擇要刪除的設備。");await db().prepare("BEGIN").run();try{for(const id of ids){const deviceId=String(id);await db().prepare("DELETE FROM grants WHERE device_id=?").bind(deviceId).run();await db().prepare("DELETE FROM device_locations WHERE aslung_id=?").bind(deviceId).run();await db().prepare("DELETE FROM devices WHERE id=?").bind(deviceId).run();}await db().prepare("COMMIT").run();}catch(e){await db().prepare("ROLLBACK").run();throw e;}}
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
 
 try {
   await db().prepare("INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,'member',1,?)").bind(email,crypto.randomUUID(),required(p.name),nickname,hash).run();
 } catch(e) {
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
 
 let hash = null;
 if (p.password) {
   if(!validPassword(p.password)) throw new AppError(400,"密碼需為 12 至 128 個字元。");
   hash = await hashPassword(p.password);
 }
 
 try {
   await db().prepare("BEGIN").run(); await db().prepare("PRAGMA defer_foreign_keys=ON").run();
   
   if (hash) {
     db().prepare("UPDATE members SET name=?, nickname=?, password_hash=? WHERE email=?").bind(name, nickname, hash, originalEmail).run();
   } else {
     db().prepare("UPDATE members SET name=?, nickname=? WHERE email=?").bind(name, nickname, originalEmail).run();
   }

   if (newEmail !== originalEmail) {
     db().prepare("UPDATE members SET email=? WHERE email=?").bind(newEmail, originalEmail).run();
     db().prepare("UPDATE grants SET email=? WHERE email=?").bind(newEmail, originalEmail).run();
     db().prepare("UPDATE sessions SET email=? WHERE email=?").bind(newEmail, originalEmail).run();
     db().prepare("UPDATE api_tokens SET email=? WHERE email=?").bind(newEmail, originalEmail).run();
     db().prepare("UPDATE file_grants SET email=? WHERE email=?").bind(newEmail, originalEmail).run();
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
 else if(p.action==="memberRole"){requireAdmin();const email=required(p.email);if(email===me.email)throw new AppError(400,"無法修改自己的角色。");await db().prepare("UPDATE members SET role=? WHERE email=?").bind(p.role==="admin"?"admin":"member",email).run();}
 else if(p.action==="memberStatus"){requireAdmin();const email=required(p.email);if(email===me.email)throw new AppError(400,"無法停用自己的帳號。");await db().prepare("UPDATE members SET active=? WHERE email=?").bind(p.active?1:0,email).run();}
 else if(p.action==="grant"){requireAdmin();const device_id=required(p.deviceId),email=required(p.email),start=instant(p.start),end=p.end?instant(p.end):null;if(end&&start>end)throw new AppError(400,"結束時間必須晚於開始時間。");if(p.id){await db().prepare("UPDATE grants SET device_id=?, email=?, start=?, end=? WHERE id=?").bind(device_id,email,start,end,p.id).run();}else{await db().prepare("INSERT INTO grants(device_id,email,start,end) VALUES(?,?,?,?)").bind(device_id,email,start,end).run();}}
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
  const emailTest=String(p.email_test||"").trim();
  const phone=String(p.phone||"").trim();
  const notes=String(p.notes||"").trim();
  const now=new Date().toISOString();
  await db().prepare(`
    INSERT INTO maintainers(name,email,email_test,phone,notes,created_at)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET
      email=excluded.email, email_test=excluded.email_test, phone=excluded.phone, notes=excluded.notes
  `).bind(name,email,emailTest,phone,notes,now).run();
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
  const mainIdx=headers.indexOf("maintainer"), mailIdx=headers.indexOf("mail"), testIdx=headers.indexOf("mail_test");
  if(mainIdx===-1||mailIdx===-1)throw new AppError(400,"試算表需包含 maintainer 與 mail 欄位。");
  const now=new Date().toISOString();
  await db().prepare("BEGIN").run();
  let syncedCount=0;
  try{
    const upsert=db().prepare(`
      INSERT INTO maintainers(name,email,email_test,phone,notes,created_at)
      VALUES(?,?,?,'','',?)
      ON CONFLICT(name) DO UPDATE SET
        email=excluded.email, email_test=excluded.email_test
    `);
    for(let i=1;i<rows.length;i++){
      const cols=rows[i];
      const name=mainIdx!==-1&&cols[mainIdx]?cols[mainIdx].trim():"";
      const mail=mailIdx!==-1&&cols[mailIdx]?cols[mailIdx].trim():"";
      if(!name||!mail)continue;
      const mailTest=(testIdx!==-1&&cols[testIdx]?cols[testIdx].trim():"")||"";
      await upsert.bind(name,mail,mailTest,now).run();
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
} else if(p.action==="alertSettingsUpdate"){
  requireAdmin();
  const enabled=p.enabled?1:0;
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
      SET enabled=?, check_interval_mins=?, offline_threshold_mins=?, use_test_email=?,
          smtp_host=?, smtp_port=?, smtp_user=?, smtp_pass=?, smtp_from=?
      WHERE id=1
    `).bind(enabled,checkInterval,offlineThreshold,useTestEmail,smtpHost,smtpPort,smtpUser,smtpPass,smtpFrom).run();
  } else {
    await db().prepare(`
      UPDATE alert_settings
      SET enabled=?, check_interval_mins=?, offline_threshold_mins=?, use_test_email=?,
          smtp_host=?, smtp_port=?, smtp_user=?, smtp_from=?
      WHERE id=1
    `).bind(enabled,checkInterval,offlineThreshold,useTestEmail,smtpHost,smtpPort,smtpUser,smtpFrom).run();
  }
} else if(p.action==="fileDelete"){
  requireAdmin();
  const fileId=required(p.id);
  const file:any=await db().prepare("SELECT * FROM files WHERE id=?").bind(fileId).first();
  if(file){
    if(file.storage_path){try{const fsMod=await import("node:fs");if(fsMod.existsSync(file.storage_path))fsMod.unlinkSync(file.storage_path);}catch{}}
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
} else throw new AppError(400,"不支援此操作。");
 return Response.json({ok:true});
}catch(e){if(e instanceof Error&&e.message.includes("UNIQUE constraint"))return Response.json({error:"此 ID 或名稱已存在。"},{status:409});return fail(e)}}
