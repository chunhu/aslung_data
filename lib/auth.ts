import {cookies} from "next/headers";
import {getConnection} from "./store.mjs";
import {tokenHash} from "./passwords.mjs";
export const COOKIE_NAME="aslung_session";
export async function getSessionUser(){
 const token=(await cookies()).get(COOKIE_NAME)?.value;
 if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
 const row=getConnection().prepare("SELECT m.email,m.name,m.user_id FROM sessions s JOIN members m ON m.email=s.email WHERE s.token_hash=? AND s.expires_at>? AND m.active=1").get(tokenHash(token),Date.now()) as {email:string;name:string;user_id:string}|undefined;
 return row?{email:row.email,displayName:row.name,userId:row.user_id}:null;
}
export function sessionCookie(token:string,maxAge=43200){
 return {name:COOKIE_NAME,value:token,httpOnly:true,secure:process.env.APP_ORIGIN?.startsWith("https://")??true,sameSite:"lax" as const,path:"/",maxAge};
}
