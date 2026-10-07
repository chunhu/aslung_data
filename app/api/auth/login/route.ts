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
 if(!member||!member.active||!valid)throw new AppError(401,"Email 或密碼不正確。");
 d.prepare("DELETE FROM login_attempts WHERE email=?").run(inputId);d.prepare("DELETE FROM sessions WHERE expires_at<?").run(now);
 const token=randomBytes(32).toString("hex");
 d.prepare("INSERT INTO sessions(token_hash,email,expires_at) VALUES(?,?,?)").run(tokenHash(token),member.email,now+43200000);
 const response=NextResponse.json({ok:true},{headers:{"Cache-Control":"no-store"}});response.cookies.set(sessionCookie(token));return response;
}catch(e){return fail(e)}}
