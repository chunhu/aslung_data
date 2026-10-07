"use client";
import {useState} from "react";
import {Activity,LockKeyhole} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
export default function LoginForm(){
 const [error,setError]=useState(""),[busy,setBusy]=useState(false);
 return <main className="min-h-screen flex items-center justify-center p-6 bg-[#102d40]"><section className="panel p-8 sm:p-12 w-full max-w-md"><div className="brand-mark mb-6"><Activity/></div><p className="eyebrow">ASLUNG DATA MANAGEMENT</p><h1>會員登入</h1><p className="subheading mb-6">登入以查詢您的授權設備與量測資料。</p><form className="modal-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError("");const p=Object.fromEntries(new FormData(e.currentTarget));try{const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});const data=await r.json();if(!r.ok)throw new Error(data.error);window.location.assign("/");}catch(e){setError((e as Error).message);setBusy(false)}}}><Label htmlFor="login-email">Email 或 登入暱稱</Label><Input id="login-email" name="email" type="text" maxLength={254} autoComplete="username" placeholder="輸入 Email 或暱稱" required/><Label htmlFor="login-password">密碼</Label><Input id="login-password" name="password" type="password" maxLength={128} autoComplete="current-password" required/>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<Button type="submit" disabled={busy} className="mt-4 h-11">{busy?"登入中…":"登入"}</Button></form><p className="text-xs text-slate-500 mt-6 leading-6 flex gap-2"><LockKeyhole size={15} className="shrink-0 mt-1"/>帳號由管理員建立。如忘記密碼，請聯絡管理員重設。</p></section></main>;
}
