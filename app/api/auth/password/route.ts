import {NextResponse} from "next/server";
import {getConnection} from "@/lib/store.mjs";
import {hashPassword,verifyPassword,validPassword} from "@/lib/passwords.mjs";
import {sessionCookie} from "@/lib/auth";
import {identity,writeGuard,fail,AppError} from "@/lib/server";
export const runtime="nodejs";
export async function POST(r:Request){try{
 writeGuard(r);const me=await identity(),p=await r.json() as any;
 if(!p||!validPassword(p.password))throw new AppError(400,"新密碼需為 12 至 128 個字元。");
 if(!await verifyPassword(p.currentPassword,me.password_hash))throw new AppError(400,"目前密碼不正確。");
 const hash=await hashPassword(p.password),d=getConnection();
 d.exec("BEGIN IMMEDIATE");try{d.prepare("UPDATE members SET password_hash=? WHERE email=?").run(hash,me.email);d.prepare("DELETE FROM sessions WHERE email=?").run(me.email);d.exec("COMMIT");}catch(e){d.exec("ROLLBACK");throw e;}
 const response=NextResponse.json({ok:true});response.cookies.set(sessionCookie("",0));return response;
}catch(e){return fail(e)}}
