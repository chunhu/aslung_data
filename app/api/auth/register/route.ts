import {getConnection} from '@/lib/store.mjs';
import {registerMember,resendVerification,verifyRegistration,rateLimitRegistration,RegistrationError} from '@/lib/registration.mjs';
import {registrationMailer} from '@/lib/registration-mail';
import {writeGuard,AppError,fail} from '@/lib/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  try {
    writeGuard(request);
    const text=await request.text();
    if(text.length>16000)throw new AppError(413,'表單內容過長 / Form is too large.');
    let input:any;try{input=JSON.parse(text);}catch{throw new AppError(400,'無效的表單 / Invalid form.');}
    if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError(400,'無效的表單 / Invalid form.');
    const d=getConnection();
    // A site-wide ceiling also bounds traffic when a reverse proxy does not
    // provide a reliable client IP. No IP address is persisted in this table.
    rateLimitRegistration(d,'site',100);
    const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
    rateLimitRegistration(d,'ip:'+ip,20);
    if(input.action==='verify')verifyRegistration(d,input.token);
    else if(input.action==='resend')await resendVerification(d,input,registrationMailer().verify);
    else if(input.action===undefined||input.action==='register')await registerMember(d,input,registrationMailer().verify);
    else throw new AppError(400,'無效的操作 / Invalid action.');
    return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return fail(e instanceof RegistrationError ? new AppError(e.status,e.message) : e);}
}
