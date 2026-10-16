"use client";
import {useState} from 'react';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import useAppLanguage from '@/components/useAppLanguage';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import MemberProfileFields from '@/components/MemberProfileFields';

export default function RegistrationForm({initialLanguage}:{initialLanguage?:string}) {
  const language=useAppLanguage(initialLanguage);
  const [mode,setMode]=useState<'register'|'resend'>('register');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false);
  const en=language!=='zh-TW';
  return <main className="min-h-screen bg-[#102d40] px-4 py-10" translate="no" lang={en?"en":"zh-Hant"}>
    <section className="panel w-full max-w-2xl mx-auto p-6 sm:p-10">
      <div className="flex justify-between gap-3 items-center mb-6"><a href="/login" className="text-teal-700 text-sm underline">{en?'Back to sign in':'返回登入'}</a>
        <LanguageSwitcher reloadOnChange={false} translatePage={false}/></div>
      <p className="eyebrow">ASLUNG DATA MANAGEMENT</p><h1 className="text-2xl font-semibold mt-2">{mode==='resend'?(en?'Resend verification email':'重新寄送驗證信'):(en?'Membership application':'申請會員帳號')}</h1>
      <p className="text-sm text-slate-600 my-4">{en?'Verify your email, then wait for administrator approval. Data access is granted separately.':'註冊後請先驗證 Email，再等待管理員審核；設備與資料期間由管理員另行授權。'}</p>
      {success?<div role="status" className="bg-teal-50 border border-teal-200 rounded p-4 space-y-3">
        <p>{en?'If eligible, a verification email has been sent. Check your inbox and spam folder. The link expires in 24 hours.':'符合寄送條件時，驗證信已寄出。請查看收件匣及垃圾郵件，連結有效期限為 24 小時。'}</p>
        <Button type="button" variant="outline" onClick={()=>{setMode('resend');setSuccess(false);setError('');}}>{en?'Resend email':'重新寄送驗證信'}</Button>
      </div>:<form className="space-y-4" onSubmit={async event=>{
        event.preventDefault();setBusy(true);setError('');
        const payload={...Object.fromEntries(new FormData(event.currentTarget)),language:en?"en":"zh-TW",action:mode};
        try {const response=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          const data=await response.json();if(!response.ok)throw new Error(data.error);setSuccess(true);
        }catch(e){setError((e as Error).message);}finally{setBusy(false);}
      }}>
        {mode==='register'&&<><div className="space-y-2"><Label htmlFor="register-name">{en?'Full name':'姓名'} *</Label><Input id="register-name" name="name" autoComplete="name" required maxLength={160}/></div>
          <div className="space-y-2"><Label htmlFor="register-nickname">{en?'Username':'登入帳號'} *</Label><Input id="register-nickname" name="nickname" autoComplete="username" required maxLength={80} pattern="[A-Za-z0-9_-]+"/><p className="text-xs text-slate-500">{en?'Letters, digits, underscores and hyphens.':'僅限英數字、底線與連字號。'}</p></div></>}
        <div className="space-y-2"><Label htmlFor="register-email">Email *</Label><Input id="register-email" name="email" type="email" autoComplete="email" required maxLength={254}/></div>
        <div className="space-y-2"><Label htmlFor="register-password">{en?'Password (12–128 characters)':'密碼（12 至 128 字元）'} *</Label><Input id="register-password" name="password" type="password" autoComplete={mode==='register'?'new-password':'current-password'} required minLength={12} maxLength={128}/></div>
        {mode==='register'&&<><div className="space-y-2"><Label htmlFor="register-confirm">{en?'Confirm password':'確認密碼'} *</Label><Input id="register-confirm" name="confirm_password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></div><MemberProfileFields required isEnglish={en}/></>}
        {error&&<p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
        <Button type="submit" className="w-full h-11" disabled={busy}>{busy?(en?'Submitting…':'送出中…'):mode==='resend'?(en?'Resend verification email':'重新寄送驗證信'):(en?'Submit application':'送出註冊申請')}</Button>
        <button type="button" className="text-sm text-teal-700 underline" onClick={()=>{setMode(mode==='register'?'resend':'register');setError('');}}>{mode==='register'?(en?'Already registered? Resend verification email':'已註冊但尚未收到驗證信？重新寄送'):(en?'Create an account':'申請新帳號')}</button>
      </form>}
    </section>
  </main>;
}
