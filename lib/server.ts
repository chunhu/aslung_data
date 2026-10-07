import crypto from "node:crypto";
import {getStore} from "./store.mjs";
import {getSessionUser} from "./auth";
export class AppError extends Error { constructor(public status:number,message:string){super(message)} }
export function db(){return getStore();}
export function config(){const e=process.env;return {url:e.MYSQL_HOST || "35.160.61.178", token:e.MYSQL_PASSWORD || "datasel"};}
export async function identity(r?: Request){
 let email = "";
 let userId = "";
 if (r) {
   const auth = r.headers.get("authorization");
   if (auth && auth.startsWith("Bearer ")) {
     const token = auth.substring(7);
     const tk: any = await db().prepare("SELECT email FROM api_tokens WHERE id=?").bind(token).first();
     if (!tk) throw new AppError(401, "無效的 API 存取權杖。");
     email = tk.email;
   }
 }
 if (!email) {
   const u=await getSessionUser();if(!u)throw new AppError(401,"請先登入。");
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
export function fail(e:unknown){if(e instanceof AppError)return Response.json({error:e.message},{status:e.status,headers:{"Cache-Control":"no-store"}});console.error(e);return Response.json({error:"服務暫時無法使用，請稍後重試。"}, {status:503});}
export function writeGuard(r:Request){const origin=r.headers.get("origin");if(!process.env.APP_ORIGIN||origin!==process.env.APP_ORIGIN)throw new AppError(403,"請從網站內送出操作。");}
export function required(v:unknown,max=160){if(typeof v!=="string"||!v.trim()||v.length>max)throw new AppError(400,"請完整填寫欄位。");return v.trim();}
export function instant(v:unknown){const s=required(v);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(s)||!Number.isFinite(Date.parse(s)))throw new AppError(400,"時間格式不正確。");return new Date(s).toISOString();}
export async function permitted(m:any,id:string,start:string,end:string){
 const device=await db().prepare("SELECT * FROM devices WHERE id=?").bind(id).first();if(!device)throw new AppError(404,"找不到 ASLUNG ID。");
 if(m.role!=="admin"){const grants:any=await db().prepare("SELECT * FROM grants WHERE device_id=? AND email=?").bind(id,m.email).all();if(!grants.results.some((g:any)=>start>=g.start&&(!g.end||end<=g.end)))throw new AppError(403,"此設備或查詢期間未授權。");}
 return device;
}
