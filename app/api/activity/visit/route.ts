import {limitedBody,limitedJson,HttpSecurityError} from "@/lib/http-security.mjs";
import {NextResponse} from 'next/server';
import {cookies} from 'next/headers';
import {randomBytes} from 'node:crypto';
import {getConnection,getSiteStats} from '@/lib/store.mjs';
import {getSessionUser} from '@/lib/auth';
import {recordVisit,clientIp,limitActivity,pruneActivity,ActivityError} from '@/lib/activity.mjs';
import {writeGuard,AppError,fail} from '@/lib/server';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request){try{
  writeGuard(request);
  const text=new TextDecoder().decode(await limitedBody(request,512));if(text.length>512)throw new AppError(413,'內容過長。');
  let body:any;try{body=JSON.parse(text);}catch{throw new AppError(400,'內容格式不正確。');}
  const d=getConnection(),ip=clientIp(request);limitActivity(d,'visit:site',2000);limitActivity(d,'visit:ip:'+ip,120);
  const old=(await cookies()).get('aslung_visitor')?.value,visitor=old&&/^[a-f0-9]{64}$/.test(old)?old:randomBytes(32).toString('hex');
  const user=await getSessionUser();
  recordVisit(d,{path:body?.path,visitor:user?'member:'+user.userId:'visitor:'+visitor,email:user?.email||'',ip,userAgent:request.headers.get('user-agent')||''});pruneActivity(d);
  const response=NextResponse.json(getSiteStats(),{headers:{'Cache-Control':'no-store'}});
  if(visitor!==old)response.cookies.set({name:'aslung_visitor',value:visitor,httpOnly:true,secure:process.env.APP_ORIGIN?.startsWith('https://')??true,sameSite:'lax',path:'/',maxAge:30*86400});
  return response;
}catch(e){return fail(e instanceof HttpSecurityError||e instanceof ActivityError?new AppError(e.status,e.message):e);}}
