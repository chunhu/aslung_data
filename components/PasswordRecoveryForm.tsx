"use client";
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import useAppLanguage from '@/components/useAppLanguage';

export default function PasswordRecoveryForm({mode,isEnglish}:{mode:'request'|'reset';isEnglish?:boolean}){
  const language=useAppLanguage(isEnglish===undefined?undefined:isEnglish?'en':'zh-TW'),en=language!=='zh-TW';
  const [token,setToken]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
  const tokenRead=useRef(false);
  useEffect(()=>{
    if(mode==='reset'&&!tokenRead.current){
      tokenRead.current=true;
      setToken(new URLSearchParams(window.location.hash.slice(1)).get('token')||'');
      // Keep bearer tokens out of the address bar, referrers and subsequent history entries.
      window.history.replaceState(null,'',window.location.pathname+window.location.search);
    }
    setReady(true);
  },[mode]);
  return <main translate="no" lang={en?'en':'zh-Hant'} className="min-h-screen bg-[#102d40] p-6 flex items-center justify-center"><section className="panel max-w-lg w-full p-8 space-y-5">
    <div className="flex justify-end"><LanguageSwitcher reloadOnChange={false} translatePage={false}/></div>
    <p className="eyebrow">{en?'Environmental Observation Data Hub':'環境觀測資料平台'}</p>
    <h1 className="text-2xl font-semibold">{mode==='request'?(en?'Forgot password':'忘記密碼'):(en?'Set a new password':'設定新密碼')}</h1>
    {mode==='request'&&<p className="text-sm text-slate-600">{en?'Enter the email registered with your account. The latest reset link is valid for 30 minutes and can be used once. If your account has no email address, contact an administrator.':'請輸入帳號登記的 Email。最新重設連結於 30 分鐘內有效，僅能使用一次。若帳號未登記 Email，請聯絡管理員。'}</p>}
    {done&&<p role="status" className="text-sm text-teal-800">{mode==='request'?(en?'Request received. If this email belongs to an active account, a reset link will be sent. Check your spam folder; if it does not arrive, contact an administrator.':'已收到申請。若此 Email 對應已啟用的帳號，將寄送重設連結。請檢查垃圾郵件；若未收到，請聯絡管理員。'):(en?'Password reset. All previous sign-in sessions have ended. Sign in with your new password.':'密碼已重設，所有既有登入已失效。請使用新密碼重新登入。')}</p>}
    {mode==='reset'&&ready&&!token&&!done&&<p role="alert" className="text-sm text-red-700">{en?'Reset link is missing. Please reopen the latest email or request a new link.':'缺少重設連結，請重新開啟最新郵件，或重新申請。'}</p>}
    {(mode==='request'||!done)&&<form className="space-y-3" onSubmit={async event=>{
      event.preventDefault();const form=event.currentTarget,fields=Object.fromEntries(new FormData(form));setError('');
      if(mode==='reset'&&fields.password!==fields.confirm_password){setError(en?'Passwords do not match.':'兩次密碼不一致。');return;}
      setBusy(true);
      try{
        const response=await fetch('/api/auth/password-reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,action:mode,language:en?'en':'zh-TW',...(mode==='reset'?{token}:{})})});
        const data=await response.json();if(!response.ok)throw new Error(data.error||(en?'Unable to process request.':'無法處理申請。'));
        setDone(true);if(mode==='reset'&&!tokenRead.current){
      tokenRead.current=true;form.reset();setToken('');}
      }catch(e){setError((e as Error).message);}finally{setBusy(false);}
    }}>
      {mode==='request'?<><Label htmlFor="recovery-email">Email</Label><Input id="recovery-email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={busy}/></>:<>
        <Label htmlFor="recovery-password">{en?'New password (12–128 characters)':'新密碼（12–128 字元）'}</Label><Input id="recovery-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy||!token}/>
        <Label htmlFor="recovery-confirm">{en?'Confirm new password':'再次輸入新密碼'}</Label><Input id="recovery-confirm" name="confirm_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy||!token}/>
      </>}
      <Button type="submit" disabled={busy||!ready||(mode==='reset'&&!token)}>{busy?(en?'Processing…':'處理中…'):mode==='request'?(en?'Send reset link':'寄送重設連結'):(en?'Reset password':'重設密碼')}</Button>
    </form>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {mode==='reset'&&!done&&<a className="block text-teal-700 underline text-sm" href={'/forgot-password?lang='+(en?'en':'zh-TW')}>{en?'Request a new reset link':'重新申請重設連結'}</a>}
    <a className="block text-teal-700 underline text-sm" href="/login">{en?'Back to sign in':'返回登入'}</a>
  </section></main>;
}
