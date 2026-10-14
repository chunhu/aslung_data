"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
export default function VerifyEmailForm({token:initialToken,isEnglish:en}:{token:string;isEnglish:boolean}) {
  const [token,setToken]=useState(initialToken);
  useEffect(()=>{const fragment=new URLSearchParams(window.location.hash.slice(1)).get('token');if(fragment)setToken(fragment);},[]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[verified,setVerified]=useState(false);
  return <main translate="no" lang={en?"en":"zh-Hant"} className="min-h-screen bg-[#102d40] p-6 flex items-center justify-center"><section className="panel max-w-lg w-full p-8 space-y-5">
    <p className="eyebrow">ASLUNG DATA MANAGEMENT</p><h1 className="text-2xl font-semibold">{en?'Verify your email':'驗證 Email'}</h1>
    {verified?<p role="status" className="text-teal-800">{en?'Email verified. Your application is awaiting administrator review. Approval and data access are assigned separately.':'Email 驗證完成，申請已送交管理員審核。帳號啟用與資料授權將分別處理。'}</p>:<>
      <p>{en?'Confirm your email to send your application for administrator review.':'請確認驗證 Email，完成後會將申請送交管理員審核。'}</p>
      <Button disabled={busy||!token} onClick={async()=>{setBusy(true);setError('');try{
        const response=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',token})});
        const data=await response.json();if(!response.ok)throw new Error(data.error);setVerified(true);
        window.history.replaceState(null,'','/verify-email?lang='+(en?'en':'zh-TW'));
      }catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?(en?'Verifying…':'驗證中…'):(en?'Verify email':'確認驗證 Email')}</Button>
      {(!token||error)&&<p role="alert" className="text-red-700 text-sm">{error||(en?'Verification token is missing. Please resend the email.':'缺少驗證碼，請重新寄送驗證信。')}</p>}
      <a className="block text-teal-700 underline text-sm" href={'/register?lang='+(en?'en':'zh-TW')}>{en?'Resend verification email':'重新寄送驗證信'}</a>
    </>}
    <a className="block text-teal-700 underline" href="/login">{en?'Back to sign in':'返回登入'}</a>
  </section></main>;
}
