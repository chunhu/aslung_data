import {limitedBody,limitedJson,HttpSecurityError,clientIp} from "@/lib/http-security.mjs";
import {recordRequestEvent} from "@/lib/activity-server";
import {after} from 'next/server';
import {getConnection} from '@/lib/store.mjs';
import {resetEmail,issuePasswordReset,completePasswordReset,PasswordResetError} from '@/lib/password-reset.mjs';
import {rateLimitRegistration,RegistrationError} from '@/lib/registration.mjs';
import {registrationMailer} from '@/lib/registration-mail';
import {tokenHash} from '@/lib/passwords.mjs';
import {writeGuard,fail,AppError} from '@/lib/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
  writeGuard(request);
  const text=new TextDecoder().decode(await limitedBody(request,4096));if(text.length>4096)throw new AppError(413,'表單內容過長 / Form is too large.');
  let input:any;try{input=JSON.parse(text);}catch{throw new AppError(400,'無效的表單 / Invalid form.');}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError(400,'無效的表單 / Invalid form.');
  if(!['request','reset'].includes(input.action))throw new AppError(400,'無效的操作 / Invalid action.');
  const d=getConnection(),ip=clientIp(request)||'unknown';
  rateLimitRegistration(d,'password-reset:site',100);
  rateLimitRegistration(d,'password-reset:ip:'+ip,20);
  if(input.action==='request'){
    const email=resetEmail(input.email);
    rateLimitRegistration(d,'password-reset:email:'+email,3);
    // Check service configuration identically for known and unknown accounts.
    let mailer:ReturnType<typeof registrationMailer>;
    try{mailer=registrationMailer();}catch{throw new AppError(503,'重設密碼郵件服務尚未設定，請聯絡管理員 / Password reset email is unavailable. Please contact the administrator.');}
    recordRequestEvent(request,{kind:"auth",event:"password.reset.request",target:email});
    const mail=issuePasswordReset(d,email,input.language);
    // Delivery never changes the public response or reveals account existence.
    after(async()=>{
      if(!mail)return;
      try{await mailer.resetPassword(mail);}catch{
        d.prepare('DELETE FROM password_resets WHERE token_hash=?').run(tokenHash(mail.token));
        recordRequestEvent(request,{kind:'auth',event:'password.reset.delivery',outcome:'failure'});
        console.error('[Password reset] Email delivery failed. Check SMTP settings.');
      }
    });
  }else {const email=await completePasswordReset(d,input);recordRequestEvent(request,{kind:'auth',event:'password.reset.complete',actor:email});}
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
}catch(e){recordRequestEvent(request,{kind:'auth',event:'password.reset',outcome:'failure'});return fail(e instanceof HttpSecurityError||e instanceof PasswordResetError||e instanceof RegistrationError?new AppError(e.status,e.message):e);}}
