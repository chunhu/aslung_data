import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {getConnection} from "@/lib/store.mjs";
import {tokenHash} from "@/lib/passwords.mjs";
import {COOKIE_NAME,sessionCookie} from "@/lib/auth";
import {writeGuard,fail} from "@/lib/server";
export const runtime="nodejs";
export async function POST(r:Request){try{writeGuard(r);const token=(await cookies()).get(COOKIE_NAME)?.value;if(token)getConnection().prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));const response=NextResponse.json({ok:true});response.cookies.set(sessionCookie("",0));return response;}catch(e){return fail(e)}}
