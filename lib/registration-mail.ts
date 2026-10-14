import nodemailer from 'nodemailer';
import {getConnection} from './store.mjs';
import {RegistrationError} from './registration.mjs';

export function registrationMailer() {
  const settings=getConnection().prepare('SELECT smtp_host,smtp_port,smtp_user,smtp_pass,smtp_from FROM alert_settings WHERE id=1').get() as any;
  let origin:URL;
  try {origin=new URL(process.env.APP_ORIGIN || '');if(!['http:','https:'].includes(origin.protocol))throw new Error();}
  catch {throw new RegistrationError(503,'註冊服務尚未設定網站網址 / Registration website URL is not configured.');}
  if(!settings?.smtp_host || !settings?.smtp_from)
    throw new RegistrationError(503,'註冊驗證郵件尚未設定，請聯絡管理員 / Registration email is not configured. Please contact the administrator.');
  const transport=nodemailer.createTransport({
    host:settings.smtp_host, port:Number(settings.smtp_port)||587,
    secure:Number(settings.smtp_port)===465, requireTLS:Number(settings.smtp_port)!==465,
    ...(settings.smtp_user ? {auth:{user:settings.smtp_user,pass:settings.smtp_pass}} : {}),
    connectionTimeout:10000, greetingTimeout:10000, socketTimeout:15000
  });
  return {
    async verify({email,language,token}:{email:string;name:string;language:string;token:string}) {
      const link=new URL('/verify-email',origin);link.hash=new URLSearchParams({token}).toString();link.searchParams.set('lang',language==='en'?'en':'zh-TW');
      try {
        await transport.sendMail({from:settings.smtp_from,to:email,
          subject:'ASLUNG — Verify your email / 驗證您的 Email',
          text:`Please verify your email using the link below (valid for 24 hours). After verification, an administrator will review your application. Approval does not automatically grant data access.\n\n請使用下方連結驗證 Email（24 小時內有效），完成後將由管理員審核。帳號啟用與資料授權分開管理。\n\n${link.href}\n\nIf you did not register, you can ignore this email. 若非您本人申請，請忽略此信。`});
      }catch {throw new RegistrationError(503,'申請已儲存，但驗證信寄送失敗，請稍後使用重新寄送功能 / Application saved, but email delivery failed. Please resend the verification email later.');}
    },
    async review(email:string,approved:boolean) {
      await transport.sendMail({from:settings.smtp_from,to:email,
        subject:approved?'ASLUNG — Account approved / 帳號審核通過':'ASLUNG — Application update / 申請審核結果',
        text:approved
          ? `Your ASLUNG account has been approved. Data access is assigned separately by an administrator.\n您的 ASLUNG 帳號已通過審核，設備與資料期間將由管理員另行授權。\n${new URL('/login',origin).href}`
          : 'Your ASLUNG application was not approved. Please contact your project coordinator.\n您的 ASLUNG 註冊申請未通過審核，請聯絡合作計畫窗口。'});
    }
  };
}
