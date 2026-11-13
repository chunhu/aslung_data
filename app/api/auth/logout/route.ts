import {recordRequestEvent} from "@/lib/activity-server";
import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {getConnection} from "@/lib/store.mjs";
import {tokenHash} from "@/lib/passwords.mjs";
import {COOKIE_NAME,sessionCookie} from "@/lib/auth";
import {writeGuard,fail} from "@/lib/server";
export const runtime="nodejs";
export async function POST(r:Request){try{writeGuard(r);const token=(await cookies()).get(COOKIE_NAME)?.value;if(token){const d=getConnection(),session=d.prepare("SELECT email FROM sessions WHERE token_hash=?").get(tokenHash(token));d.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));recordRequestEvent(r,{kind:"auth",event:"logout",actor:session?.email});}const response=NextResponse.json({ok:true});response.cookies.set(sessionCookie("",0));return response;}catch(e){return fail(e)}}
