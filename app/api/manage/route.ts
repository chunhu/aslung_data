import crypto from "node:crypto";
import {randomUUID} from "node:crypto";
import {hashPassword,validPassword} from "@/lib/passwords.mjs";
import {admin,identity,db,config,fail,writeGuard,required,instant,AppError} from "@/lib/server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){try{
 const m=await identity();const isAdmin=m.role==="admin";
 const devices=(await (isAdmin?db().prepare("SELECT * FROM devices ORDER BY id"):db().prepare("SELECT d.*,g.start,g.end FROM devices d JOIN grants g ON g.device_id=d.id WHERE g.email=? ORDER BY d.id").bind(m.email)).all()).results;
 const members=isAdmin?(await db().prepare("SELECT email,name,nickname,role,active FROM members ORDER BY role,email").all()).results:[];
 const grants=isAdmin?(await db().prepare("SELECT * FROM grants ORDER BY device_id,email,start DESC").all()).results:[];
 const locations=(await db().prepare("SELECT * FROM device_locations ORDER BY start_time DESC").all()).results;
 const tokens=(await db().prepare("SELECT id, created_at FROM api_tokens WHERE email=? ORDER BY created_at DESC").bind(m.email).all()).results; return Response.json({me:{email:m.email,name:m.name,role:m.role},devices,members,grants,locations,tokens,connected:!!(config().url&&config().token)},{headers:{"Cache-Control":"no-store"}});
}catch(e){return fail(e)}}
export async function POST(r:Request){try{
 writeGuard(r);const me=await identity(r);const isAdmin=me.role==="admin";const p=await r.json() as Record<string,unknown>;if(!p||typeof p!=="object"||Array.isArray(p))throw new AppError(400,"請提供正確的表單資料。");
 const requireAdmin=()=>{if(!isAdmin)throw new AppError(403,"權限不足。")};
 if(p.action==="tokenCreate"){const token="aslung_"+crypto.randomBytes(24).toString("hex");await db().prepare("INSERT INTO api_tokens(id,email,created_at) VALUES(?,?,?)").bind(token,me.email,new Date().toISOString()).run();}else if(p.action==="tokenDelete"){await db().prepare("DELETE FROM api_tokens WHERE id=? AND email=?").bind(String(p.id),me.email).run();}else if(p.action==="device"){requireAdmin();const id=required(p.id,80);if(!/^[A-Za-z0-9_-]+$/.test(id))throw new AppError(400,"ASLUNG ID 只能使用英文、數字、底線與連字號。");await db().prepare("INSERT INTO devices(id,name,location,description) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET description=excluded.description").bind(id,"","",String(p.description??"").slice(0,1000)).run();const labId=String(p.labId||"").trim();const currentLoc=await db().prepare("SELECT id, lab_id FROM device_locations WHERE aslung_id=? AND active=1").bind(id).first();if(labId){if(!currentLoc||currentLoc.lab_id!==labId){const now=new Date().toISOString();if(currentLoc)await db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE id=?").bind(now,currentLoc.id).run();await db().prepare("INSERT INTO device_locations(lab_id,aslung_id,start_time,active) VALUES(?,?,?,1)").bind(labId,id,now).run();}}else if(currentLoc){const now=new Date().toISOString();await db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE id=?").bind(now,currentLoc.id).run();}}
 else if(p.action==="deviceImport"){requireAdmin();const devices=p.devices;if(!Array.isArray(devices))throw new AppError(400,"參數錯誤");const insertDevice=db().prepare("INSERT INTO devices(id,name,location,description) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING");const checkLoc=db().prepare("SELECT id, lab_id FROM device_locations WHERE aslung_id=? AND active=1").bind("");const endLoc=db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE id=?");const insertLoc=db().prepare("INSERT INTO device_locations(lab_id,aslung_id,start_time,active) VALUES(?,?,?,1)");for(const d of devices){const id=typeof d==="string"?d:d.id;const labId=(d.labId||"").trim();if(typeof id==="string"&&/^[A-Za-z0-9_-]+$/.test(id)){insertDevice.bind(id,"","","").run();if(labId){const currentLoc=await db().prepare("SELECT id, lab_id FROM device_locations WHERE aslung_id=? AND active=1").bind(id).first();if(!currentLoc||currentLoc.lab_id!==labId){const now=new Date().toISOString();if(currentLoc)endLoc.bind(now,currentLoc.id).run();insertLoc.bind(labId,id,now).run();}}}}} else if(p.action==="deviceDelete"){requireAdmin();const id=required(p.id);await db().prepare("DELETE FROM grants WHERE device_id=?").bind(id).run();await db().prepare("DELETE FROM device_locations WHERE aslung_id=?").bind(id).run();await db().prepare("DELETE FROM devices WHERE id=?").bind(id).run();}
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
     // Ignore errors if api_tokens/login_attempts don't exist or fail
     try { db().prepare("UPDATE api_tokens SET email=? WHERE email=?").bind(newEmail, originalEmail).run(); } catch(e){}
     try { db().prepare("UPDATE login_attempts SET email=? WHERE email=?").bind(newEmail, originalEmail).run(); } catch(e){}
   }
   
   await db().prepare("COMMIT").run();
 } catch(e) {
   await db().prepare("ROLLBACK").run();
   if (String(e).includes("UNIQUE constraint failed: members.nickname")) {
     throw new AppError(400, "此帳號 (暱稱) 已被使用，請更換一個。");
   }
   if (String(e).includes("UNIQUE constraint failed: members.email")) {
     throw new AppError(400, "此 Email 已被註冊。");
   }
   throw e;
 }
}
 else if(p.action==="memberRole"){requireAdmin();const email=required(p.email).toLowerCase();const role=p.role==="admin"?"admin":"member";if(email===me.email&&role!=="admin")throw new AppError(400,"不能取消自己的管理員權限。");await db().prepare("UPDATE members SET role=? WHERE email=?").bind(role,email).run();}
 else if(p.action==="memberStatus"){requireAdmin();if(typeof p.active!=="boolean")throw new AppError(400,"會員狀態格式不正確。");const email=required(p.email).toLowerCase();if(email===me.email)throw new AppError(400,"不能停用自己的管理員帳號。");await db().prepare("UPDATE members SET active=? WHERE email=? AND role='member'").bind(p.active?1:0,email).run();if(!p.active)await db().prepare("DELETE FROM sessions WHERE email=?").bind(email).run();}
 else if(p.action==="grant"){requireAdmin();const id=required(p.deviceId,80),email=required(p.email,254).toLowerCase(),start=instant(p.start),end=p.end?instant(p.end):null;if(end&&start>end)throw new AppError(400,"結束時間必須晚於開始時間。");const member=await db().prepare("SELECT email FROM members WHERE email=? AND role=\'member\' AND active=1").bind(email).first();if(!member)throw new AppError(400,"請選擇有效會員。");const device=await db().prepare("SELECT id FROM devices WHERE id=?").bind(id).first();if(!device)throw new AppError(400,"請選擇有效設備。");if(p.id){await db().prepare("UPDATE grants SET device_id=?,email=?,start=?,end=? WHERE id=?").bind(id,email,start,end,Number(p.id)).run();}else{await db().prepare("INSERT INTO grants(device_id,email,start,end) VALUES(?,?,?,?)").bind(id,email,start,end).run();}}
 else if(p.action==="revoke"){requireAdmin();if(p.id){await db().prepare("DELETE FROM grants WHERE id=?").bind(Number(p.id)).run();}else{await db().prepare("DELETE FROM grants WHERE device_id=? AND email=?").bind(String(p.deviceId),String(p.email)).run();}}
 else if(p.action==="transfer"){requireAdmin();const aslungId=required(p.aslungId),labId=required(p.labId),now=new Date().toISOString();await db().prepare("UPDATE device_locations SET end_time=?, active=0 WHERE aslung_id=? AND active=1").bind(now,aslungId).run();await db().prepare("INSERT INTO device_locations(lab_id,aslung_id,start_time,active) VALUES(?,?,?,1)").bind(labId,aslungId,now).run();} else if(p.action==="endGrants"){requireAdmin();const aslungId=required(p.aslungId),now=new Date().toISOString();await db().prepare("UPDATE grants SET end=? WHERE device_id=? AND (end IS NULL OR end > ?)").bind(now,aslungId,now).run();}
 else if(p.action==="locationAdd"){requireAdmin();await db().prepare("INSERT INTO device_locations(lab_id,aslung_id,start_time,end_time,active) VALUES(?,?,?,?,?)").bind(required(p.labId),required(p.aslungId),required(p.startTime),p.endTime?String(p.endTime):null,p.active?1:0).run();}
 else if(p.action==="locationUpdate"){requireAdmin();await db().prepare("UPDATE device_locations SET lab_id=?, aslung_id=?, start_time=?, end_time=?, active=? WHERE id=?").bind(required(p.labId),required(p.aslungId),required(p.startTime),p.endTime?String(p.endTime):null,p.active?1:0,Number(p.id)).run();}
 else if(p.action==="locationDelete"){requireAdmin();await db().prepare("DELETE FROM device_locations WHERE id=?").bind(Number(p.id)).run();}
 else throw new AppError(400,"不支援此操作。");
 return Response.json({ok:true});
}catch(e){if(e instanceof Error&&e.message.includes("UNIQUE constraint"))return Response.json({error:"此 ID 或 Email 已存在。"},{status:409});return fail(e)}}
