"use client";
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
type Props={api:(url:string,options?:RequestInit)=>Promise<any>;loggers:any[];onChange:()=>void};
export default function HoboCleanup({api,loggers,onChange}:Props){
  const [serial,setSerial]=useState(''),[from,setFrom]=useState('2025-01-01'),[to,setTo]=useState(()=>new Date(Date.now()+28800000).toISOString().slice(0,10));
  const [status,setStatus]=useState<any>(null),[plan,setPlan]=useState<any>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=useCallback(async()=>{try{setStatus(await api('/api/hobo/cleanup'));}catch(e){setError((e as Error).message);}},[api]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[load]);
  async function preview(){setBusy(true);setError('');setNotice('');setPlan(null);setConfirmation('');setOpen(true);
    try{setPlan(await api('/api/hobo/cleanup',{method:'POST',body:JSON.stringify({action:'preview',filters:{serial,from,to}})}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function confirm(){if(!plan||confirmation!=='DELETE')return;setBusy(true);setError('');try{
    await api('/api/hobo/cleanup',{method:'POST',body:JSON.stringify({action:'confirm',id:plan.id,confirmation})});setOpen(false);setPlan(null);setNotice('已備份資料庫並排入清除，所選設備的同步已停用，未完成匯入工作已取消。');await load();onChange();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function retry(id:string){setBusy(true);setError('');try{await api('/api/hobo/cleanup',{method:'POST',body:JSON.stringify({action:'retry',id})});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="panel p-6 space-y-3 border border-rose-200"><h3 className="font-semibold">清除 HOBO 資料（本機＋S3）</h3><p className="text-sm text-slate-600">依臺灣時間整日清除，包含所選日期的歷次 S3 檔案、版本與刪除標記。先預覽，再輸入 DELETE 確認。每批最多 20,000 個設備日；清除由 calibration-worker 執行。</p>
    <div className="flex flex-wrap gap-3 items-end"><label className="text-sm">設備<select className="block border rounded h-9 p-1" value={serial} onChange={e=>setSerial(e.target.value)}><option value="">全部 HOBO 設備</option>{loggers.map(l=><option key={l.serial} value={l.serial}>{l.name} ({l.serial})</option>)}</select></label><label className="text-sm">開始日期<Input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="text-sm">結束日期（含當日）<Input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><Button variant="destructive" disabled={busy} onClick={()=>void preview()}>預覽清除範圍</Button></div>
    {notice&&<p role="status" className="text-teal-800">{notice}</p>}{!open&&error&&<p role="alert" className="text-rose-700">{error}</p>}
    <div className="text-xs space-y-2">{status?.plans.map((p:any)=><div key={p.id}>{p.created_at} · {p.status} · {p.done||0}/{p.total} 個設備日 {p.status!=='DONE'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void retry(p.id)}>立即重試</Button>}</div>)}{status?.errors.map((e:any)=><p className="text-rose-700" key={e.id}>{e.serial} / {e.day}：{e.error}</p>)}</div>
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="max-h-[85vh] overflow-auto"><DialogHeader><DialogTitle>確認清除 HOBO 資料</DialogTitle><DialogDescription>永久清除所選日期的量測資料；保留設備設定與清除稽核。所選設備的自動同步會停用，未完成工作會取消。日後重新啟用同步或手動匯入仍可能抓回資料。</DialogDescription></DialogHeader>
      {busy&&!plan&&<p role="status">正在盤點索引與本機資料…</p>}{error&&<p role="alert" className="text-rose-700">{error}</p>}
      {plan&&<><p>{plan.filters.serial||'全部設備'} · {plan.filters.from} ～ {plan.filters.to}（臺灣時間）</p><p>設備 {plan.devices} 台／設備日 {plan.days} 個／本機量測 {plan.local} 筆／S3 索引量測 {plan.archived} 筆</p><p>S3 每日範圍 {plan.scopes} 個，清除將涵蓋其中所有歷次檔案與版本；預覽尚未向 S3 列舉版本數。索引目前檔案大小 {(plan.bytes/1024/1024).toFixed(2)} MiB。</p><div className="max-h-40 overflow-auto text-xs">{plan.items.map((item:any)=><p key={item.serial+item.day}>{item.serial} · {item.day} · 本機 {item.local}／S3 {item.archived}</p>)}{plan.days>50&&<p>僅列出前 50 個設備日，確認後會清除全部 {plan.days} 個。</p>}</div><p className="text-xs text-slate-500">排入前會備份資料庫。備份及您電腦已下載的 CSV 不會被清除。若 S3 刪除失敗，保留本機資料與索引供重試；需另外新增 scripts/iam-hobo-cleanup.json 的權限。預覽有效 15 分鐘。</p><label className="text-sm">輸入 DELETE 確認<Input value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></label></>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>取消</Button><Button variant="destructive" disabled={busy||!plan?.days||confirmation!=='DELETE'} onClick={()=>void confirm()}>確認永久清除</Button></div>
    </DialogContent></Dialog>
  </section>;
}
