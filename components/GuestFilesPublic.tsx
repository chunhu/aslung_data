"use client";
import {useEffect,useRef,useState} from 'react';
import {PublicHeader,PublicFooter} from '@/components/PublicSite';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
async function post(body:any){const response=await fetch('/api/guest-files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok){const value=await response.json();throw new Error(value.error||'操作失敗。');}return response;}
export default function GuestFilesPublic({share=false}:{share?:boolean}){
 const [data,setData]=useState<any>(null),[query,setQuery]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState<any>(null);
 const [requestId,setRequestId]=useState(''),[token,setToken]=useState(''),[session,setSession]=useState(''),[codeSent,setCodeSent]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const tokenLoaded=useRef(false);
 useEffect(()=>{if(share&&!tokenLoaded.current){tokenLoaded.current=true;setToken(new URLSearchParams(window.location.hash.slice(1)).get('token')||'');window.history.replaceState(null,'',window.location.pathname);} },[share]);
 useEffect(()=>{if(share)return;const abort=new AbortController();setBusy(true);fetch('/api/guest-files?'+new URLSearchParams({q:query,page:String(page)}),{signal:abort.signal}).then(async r=>{const value=await r.json();if(!r.ok)throw new Error(value.error);setData(value);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});return()=>abort.abort();},[query,page,share]);
 async function run(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="public-site"><PublicHeader/><main className="public-section public-listing space-y-5">
   <h1>{share?'訪客下載 / Guest download':'公開檔案清單 / File catalogue'}</h1>
   <p className="text-slate-600">{share?'無須註冊。請以收件信箱的驗證碼確認身分後下載。':'清單僅公開檔案說明，無法直接下載。填寫單位、Email 及用途，完成 Email 驗證後由管理員審核。無須註冊會員。'}</p>
   {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}{notice&&<p role="status" className="rounded border border-teal-200 bg-teal-50 p-3 text-teal-900">{notice}</p>}
   {!share&&<><form className="flex gap-2" onSubmit={e=>{e.preventDefault();setQuery(String(new FormData(e.currentTarget).get('q')||''));setPage(1);}}><Input name="q" placeholder="搜尋檔案名稱與說明" aria-label="搜尋公開檔案" maxLength={160}/><Button disabled={busy}>搜尋</Button></form>
   <p>共 {data?.total??0} 個檔案</p><div className="space-y-3">{data?.rows.map((f:any)=><article className="rounded-lg border p-4 space-y-2" key={f.id}><h2 className="font-semibold">{f.name}</h2><p className="whitespace-pre-wrap break-words">{f.description}</p><Button disabled={busy} onClick={()=>{setSelected(f);setRequestId('');setNotice('');setError('');}}>申請下載</Button></article>)}</div>
   <div className="flex gap-3 items-center"><Button variant="outline" disabled={busy||page<=1} onClick={()=>setPage(page-1)}>上一頁</Button><span>{page} / {Math.max(data?.pages||1,1)}</span><Button variant="outline" disabled={busy||page>=(data?.pages||1)} onClick={()=>setPage(page+1)}>下一頁</Button></div>
   {selected&&<section className="rounded-lg border bg-slate-50 p-5 space-y-4"><h2 className="font-semibold">申請：{selected.name}</h2>{!requestId?<form className="space-y-3" onSubmit={e=>{e.preventDefault();const fields=Object.fromEntries(new FormData(e.currentTarget));void run(async()=>{const r=await (await post({action:'request',file_id:selected.id,...fields})).json();setRequestId(r.id);setNotice('驗證碼已寄出，請於 10 分鐘內輸入；驗證後才會送交管理員審核。');});}}>
     <label className="block">姓名 / Name<Input name="name" required maxLength={160}/></label><label className="block">單位 / Organization<Input name="organization" required maxLength={160}/></label><label className="block">Email<Input name="email" type="email" required maxLength={254}/></label><label className="block">用途 / Purpose<textarea name="purpose" required maxLength={2000} rows={4} className="w-full rounded border p-2"/></label>
     <label className="flex gap-2 text-sm"><input type="checkbox" required/>同意網站為申請審核、寄送連結及下載稽核保存上述資料、下載時間與可取得的 IP／瀏覽器資訊。</label><Button disabled={busy}>取得 Email 驗證碼</Button>
   </form>:<form className="space-y-3" onSubmit={e=>{e.preventDefault();const code=String(new FormData(e.currentTarget).get('code')||'');void run(async()=>{await post({action:'verifyRequest',id:requestId,code});setRequestId('');setSelected(null);setNotice('申請已送交管理員審核。核准後會寄送下載連結至您的 Email。');});}}><label>6 位數驗證碼<Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required/></label><Button disabled={busy}>驗證並送出申請</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>setRequestId('')}>重新填寫／寄送</Button></form>}</section>}</>}
   {share&&<section className="rounded-lg border p-5 space-y-4">
     {!session?<><p className="text-sm text-slate-500">驗證碼會寄到管理員指定的收件信箱，10 分鐘有效、最多嘗試 5 次。重新寄送後舊驗證碼失效。</p><Button disabled={busy||!token} onClick={()=>void run(async()=>{const result=await (await post({action:'code',token})).json();setCodeSent(true);setNotice('已寄送至 '+result.masked_email);})}>{codeSent?'重新寄送驗證碼':'取得 Email 驗證碼'}</Button>{!token&&<p>請由 Email 中的完整下載連結進入。</p>}
     {codeSent&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();const code=String(new FormData(e.currentTarget).get('code')||'');void run(async()=>{const result=await (await post({action:'verifyDownload',token,code})).json();setSession(result.session);setData(result);setNotice('Email 驗證完成。');});}}><label>6 位數驗證碼<Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required/></label><Button disabled={busy}>確認驗證碼</Button></form>}</>:<><h2 className="font-semibold">{data?.name}</h2><p>可用下載次數：{data?.remaining}；到期時間：{new Date(data.expires_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}（臺灣時間）</p>
       <Button disabled={busy||!data?.remaining} onClick={()=>void run(async()=>{
         const response=await post({action:'download',session});
         if(response.headers.get('Content-Type')?.includes('application/json')){const result=await response.json();setData({...data,remaining:Math.max(0,data.remaining-1)});setNotice('已記錄外部連結轉址；無法確認外部網站的下載結果。');window.location.assign(result.external_url);return;}
         const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=data.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);setData({...data,remaining:Math.max(0,data.remaining-1)});setNotice('檔案已傳送給瀏覽器，請確認瀏覽器的下載結果。');
       })}>下載檔案 / Download</Button><Button variant="outline" disabled={busy} onClick={()=>{setSession('');setCodeSent(false);setNotice('請重新取得驗證碼。');}}>重新驗證 Email</Button></>}
     <p className="text-xs text-slate-500">開始傳送即計入一次下載額度，中斷及外部轉址也計入。驗證工作階段有效 30 分鐘；重新整理後請重新開啟信中連結驗證。下載會保留收件人、單位、用途、時間、傳送狀態與可取得的 IP／瀏覽器紀錄。</p>
   </section>}
 </main><PublicFooter/></div>;
}
