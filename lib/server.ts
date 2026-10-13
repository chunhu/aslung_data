import crypto from "node:crypto";
import {getStore, recordSiteVisit, getSiteStats} from "./store.mjs";
export {recordSiteVisit, getSiteStats};
import {getSessionUser} from "./auth";
export class AppError extends Error { constructor(public status:number,message:string){super(message)} }
export function db(){return getStore();}
export function config(){const e=process.env;return {url:e.MYSQL_HOST || "35.160.61.178", token:e.MYSQL_PASSWORD || "datasel"};}
export async function identity(r?: Request){
 let email = "";
 let userId = "";
 if (r) {
   const auth = r.headers.get("authorization") || r.headers.get("x-api-key");
   if (auth) {
     let token = auth.trim();
     if (token.toLowerCase().startsWith("bearer ")) {
       token = token.slice(7).trim();
     } else if (token.toLowerCase().startsWith("bearer:")) {
       token = token.slice(7).trim();
     }
     const tk: any = await db().prepare("SELECT email FROM api_tokens WHERE id=?").bind(token).first();
     if (!tk) throw new AppError(401, "無效的 API 存取權杖。");
     email = tk.email;
   }
 }
 if (!email) {
   const u=await getSessionUser();if(!u)throw new AppError(401,"請先登入或提供有效的 API 存取權杖。");
   email = u.email;
   userId = u.userId;
 }
 const emailLower = email.toLowerCase();
 const m:any=await db().prepare("SELECT * FROM members WHERE email=?").bind(emailLower).first();
 if(!m||!m.active)throw new AppError(403,"此帳號尚未開通會員權限，請聯絡管理員。");
 if(userId){
   if(m.user_id&&m.user_id!==userId)throw new AppError(403,"帳號識別不符，請聯絡管理員。");
   if(!m.user_id)await db().prepare("UPDATE members SET user_id=? WHERE email=? AND user_id IS NULL").bind(userId,emailLower).run();
 }
 return {...m,user_id:userId || m.user_id};
}
export async function admin(){const m=await identity();if(m.role!=="admin")throw new AppError(403,"只有管理員可以操作。");return m;}
export function fail(e:unknown){if(e instanceof AppError)return Response.json({error:e.message},{status:e.status,headers:{"Cache-Control":"no-store"}});console.error(e);return Response.json({error: e instanceof Error ? e.message : "服務暫時無法使用，請稍後重試。"}, {status:500});}
export function writeGuard(r:Request){const origin=r.headers.get("origin");if(!process.env.APP_ORIGIN||origin!==process.env.APP_ORIGIN)throw new AppError(403,"請從網站內送出操作。");}
export function required(v:unknown,max=160){if(typeof v!=="string"||!v.trim()||v.length>max)throw new AppError(400,"請完整填寫欄位。");return v.trim();}
export function instant(v:unknown){
  let s=required(v);
  s = s.replace(/\s+(\d{2}:\d{2})$/, "+$1");
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}/.test(s)) {
    s = s.replace(" ", "T");
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(s)) {
    s = s + "+08:00";
  }
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(s)||!Number.isFinite(Date.parse(s)))
    throw new AppError(400,"時間格式不正確。請提供包含時區的 ISO 8601 格式，例如 2026-10-01T00:00:00+08:00（URL 請使用 %2B08:00）或 2026-09-30T16:00:00Z。");
  return new Date(s).toISOString();
}
export async function permitted(m:any,id:string,start:string,end:string){
 const device=await db().prepare("SELECT * FROM devices WHERE id=?").bind(id).first();if(!device)throw new AppError(404,"找不到 ASLUNG ID。");
 if(m.role!=="admin"){
   const grants:any=await db().prepare("SELECT * FROM grants WHERE device_id=? AND email=?").bind(id,m.email).all();
   const hasGrant = grants.results.some((g:any)=>start>=g.start&&(!g.end||end<=g.end));
   if(!hasGrant){
     const mName = String(m.name || "").trim();
     const isMaintainer = await db().prepare(`
       SELECT 1 FROM device_locations
       WHERE aslung_id=? AND (TRIM(maintainer)=TRIM(?) OR TRIM(maintainer) IN (SELECT name FROM maintainers WHERE LOWER(email)=LOWER(?)))
     `).bind(id, mName, m.email).first();
     if(!isMaintainer) throw new AppError(403,"此設備或查詢期間未授權。");
   }
 }
 return device;
}

export async function syncDeviceStatusesAndLocations(store = db()){
  // 1. 更新 location 欄位 (以 active = 1 且未結束者優先，次選最後一筆歷史紀錄)
  await store.prepare(`
    UPDATE devices
    SET location = COALESCE(
      (SELECT lab_id FROM device_locations WHERE aslung_id = devices.id AND active = 1 AND (end_time IS NULL OR end_time = '') ORDER BY start_time DESC LIMIT 1),
      (SELECT lab_id FROM device_locations WHERE aslung_id = devices.id ORDER BY start_time DESC LIMIT 1),
      ''
    )
  `).run();

  // 2. 若有進行中的擺放紀錄 (active = 1 且 end_time 為空/NULL)，且狀態為 STANDBY/DEPLOYED/空，設為 DEPLOYED (使用中)
  await store.prepare(`
    UPDATE devices
    SET status = 'DEPLOYED'
    WHERE (status = 'STANDBY' OR status = 'DEPLOYED' OR status = '' OR status IS NULL)
      AND EXISTS (
        SELECT 1 FROM device_locations
        WHERE aslung_id = devices.id AND active = 1 AND (end_time IS NULL OR end_time = '')
      )
  `).run();

  // 3. 若無任何進行中的擺放紀錄，且狀態為 DEPLOYED/STANDBY/空，設為 STANDBY (待命中)
  await store.prepare(`
    UPDATE devices
    SET status = 'STANDBY'
    WHERE (status = 'DEPLOYED' OR status = 'STANDBY' OR status = '' OR status IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM device_locations
        WHERE aslung_id = devices.id AND active = 1 AND (end_time IS NULL OR end_time = '')
      )
  `).run();
}
