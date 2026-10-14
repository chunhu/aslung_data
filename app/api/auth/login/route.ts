import {NextResponse} from "next/server";
import {randomBytes} from "node:crypto";
import {getConnection} from "@/lib/store.mjs";
import {verifyPassword,hashPassword,tokenHash} from "@/lib/passwords.mjs";
import {sessionCookie} from "@/lib/auth";
import {writeGuard,fail,AppError} from "@/lib/server";
export const runtime="nodejs";export const dynamic="force-dynamic";
let dummy:Promise<string>|undefined;
export async function POST(r:Request){try{
 writeGuard(r);const p=await r.json() as any;if(!p||typeof p.email!=="string"||typeof p.password!=="string"||p.email.length>254||p.password.length>128)throw new AppError(400,"請輸入 Email 與密碼。");
 const inputId=p.email.trim().toLowerCase(),d=getConnection(),now=Date.now();
 // Reserve the attempt before expensive password verification to bound concurrent retries.
 d.prepare("INSERT INTO login_attempts(email,window_start,failures) VALUES(?,?,0) ON CONFLICT(email) DO UPDATE SET window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END,failures=CASE WHEN window_start<? THEN 0 ELSE failures END").run(inputId,now,now-900000,now-900000);
 const attempt=d.prepare("UPDATE login_attempts SET failures=failures+1 WHERE email=? AND failures<5 RETURNING failures").get(inputId);
 if(!attempt)throw new AppError(429,"登入嘗試過多，請於 15 分鐘後再試。");
 const member=d.prepare("SELECT * FROM members WHERE email=? OR nickname=?").get(inputId, inputId) as any;
 dummy??=hashPassword(randomBytes(24).toString("hex"));
 const valid=await verifyPassword(p.password,member?.password_hash??await dummy);
 if(!member||!valid)throw new AppError(401,"Email 或密碼不正確 / Incorrect email or password.");
 d.prepare("DELETE FROM login_attempts WHERE email=?").run(inputId);
 if(!member.active){
   const profile=d.prepare("SELECT registration_status FROM member_profiles WHERE email=?").get(member.email) as any;
   const message=profile?.registration_status==="pending_email"?"請先驗證 Email；可至註冊頁重新寄送驗證信 / Please verify your email. You can resend the email on the registration page.":profile?.registration_status==="pending_review"?"Email 已驗證，帳號正在等待管理員審核 / Email verified. Your account is awaiting administrator approval.":profile?.registration_status==="rejected"?"申請未通過審核，請聯絡合作計畫窗口 / Application not approved. Please contact your project coordinator.":"帳號已停用，請聯絡管理員 / Account disabled. Please contact the administrator.";
   throw new AppError(403,message);
 }
 d.prepare("DELETE FROM sessions WHERE expires_at<?").run(now);
 const token=randomBytes(32).toString("hex");
 d.prepare("INSERT INTO sessions(token_hash,email,expires_at) VALUES(?,?,?)").run(tokenHash(token),member.email,now+43200000);
 try {
   const nowIso = new Date().toISOString();
   const ip = r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || r.headers.get("x-real-ip") || "127.0.0.1";
   const ua = r.headers.get("user-agent")?.slice(0, 255) || "";
   d.prepare("UPDATE members SET login_count = COALESCE(login_count, 0) + 1, last_login_at = ? WHERE email = ?").run(nowIso, member.email);
   d.prepare("INSERT INTO login_logs (email, ip, user_agent, created_at) VALUES (?, ?, ?, ?)").run(member.email, ip, ua, nowIso);
 } catch (err) {
   console.error("Failed to record login stats:", err);
 }
 const response=NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});response.cookies.set(sessionCookie(token));return response;
}catch(e){return fail(e)}}
