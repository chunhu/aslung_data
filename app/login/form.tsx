"use client";
import {useState, useEffect} from "react";
import {Activity,LockKeyhole,Eye} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import FontSizeAdjuster from "@/components/FontSizeAdjuster";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import useAppLanguage from "@/components/useAppLanguage";

export default function LoginForm(){
 const language=useAppLanguage(),en=language!=="zh-TW";
 const [error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [stats,setStats]=useState<{totalViews?:number;todayViews?:number}|null>(null);
 useEffect(()=>{
   fetch("/api/stats").then(r=>r.json()).then(d=>setStats(d)).catch(()=>{});
 },[]);
 return (
  <main translate="no" lang={en?"en":"zh-Hant"} className="min-h-screen relative flex items-center justify-center p-6 bg-[#102d40]">
   <div className="absolute top-5 right-6 flex items-center gap-3 z-10">
    <FontSizeAdjuster />
    <LanguageSwitcher reloadOnChange={false} translatePage={false}/>
   </div>
   <section className="panel p-8 sm:p-12 w-full max-w-md">
    <div className="brand-mark mb-6"><Activity/></div>
    <p className="eyebrow">{en?"Environmental Observation Data Hub":"環境觀測資料平台"}</p>
    <h1>{en?"Sign in":"會員登入"}</h1>
    <p className="subheading mb-6">{en?"Sign in to access your authorized devices and measurement data.":"登入以查詢您的授權設備與量測資料。"}</p>
    <form className="modal-form" onSubmit={async e=>{
      e.preventDefault();
      setBusy(true);
      setError("");
      const p=Object.fromEntries(new FormData(e.currentTarget));
      try{
        const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});
        const data=await r.json();
        if(!r.ok)throw new Error(data.error);
        window.location.assign("/" + (window.location.search || ""));
      }catch(e){
        setError((e as Error).message);
        setBusy(false);
      }
    }}>
      <Label htmlFor="login-email">{en?"Email or username":"Email 或 登入暱稱"}</Label>
      <Input id="login-email" name="email" type="text" maxLength={254} autoComplete="username" placeholder={en?"Enter your email or username":"輸入 Email 或暱稱"} required/>
      <Label htmlFor="login-password">{en?"Password":"密碼"}</Label>
      <Input id="login-password" name="password" type="password" maxLength={128} autoComplete="current-password" required/>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <Button type="submit" disabled={busy} className="mt-4 h-11">{busy?(en?"Signing in…":"登入中…"):(en?"Sign in":"登入")}</Button>
    </form>
    <p className="text-xs text-slate-500 mt-6 leading-6 flex gap-2">
      <LockKeyhole size={15} className="shrink-0 mt-1"/>
      {en?"New users can apply for an account. Email verification and administrator approval are required. Contact an administrator to reset a forgotten password.":"新使用者可申請帳號，經 Email 驗證及管理員審核後使用。如忘記密碼，請聯絡管理員重設。"}
    </p>
    <div className="mt-4 flex flex-wrap gap-4 text-sm text-teal-700"><a href="/register" className="underline">{en?"Apply for an account":"申請會員帳號"}</a><a href="/register?lang=en" className="underline" translate="no">Register in English</a></div>
    {stats && (
      <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-1.5"><Eye size={13} className="text-teal-600"/> {en?"Total visits:":"網站累計瀏覽："}<strong className="text-slate-600 font-semibold">{stats.totalViews?.toLocaleString() ?? 0}</strong> {en?"visits":"次"}</span>
        <span>{en?"Today:":"今日："}<strong className="text-slate-600 font-semibold">{stats.todayViews ?? 0}</strong> {en?"visits":"次"}</span>
      </div>
    )}
   </section>
  </main>
 );
}
