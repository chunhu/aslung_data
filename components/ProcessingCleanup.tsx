"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';

type Props={api:(path:string,options?:RequestInit)=>Promise<any>;filters:{device:string;from:string;to:string;status:string};isEnglish:boolean;formatTime:(s:string)=>string;onChange:()=>void};
const labels:Record<string,string>={QUEUED:'等待清除',RUNNING:'清除中',RETRY:'等待重試',DONE:'已清除'};
export default function ProcessingCleanup({api,filters,isEnglish:en,formatTime,onChange}:Props){
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[open,setOpen]=useState(false),[plan,setPlan]=useState<any>(null);
  const [busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState(''),[pause,setPause]=useState(true),[notice,setNotice]=useState('');
  const load=useCallback(async()=>{try{setData(await api('/api/processing/cleanup'));}catch(e){setError((e as Error).message);}},[api]);
  const currentPlan=useRef(0);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),10000);return()=>{clearInterval(timer);currentPlan.current++;};},[load]);
  async function preview(){
    const generation=++currentPlan.current;setOpen(true);setPlan(null);setError('');setConfirmation('');setNotice('');setBusy(true);
    try{const result=await api('/api/processing/cleanup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'preview',filters})});if(generation===currentPlan.current)setPlan(result);}
    catch(e){if(generation===currentPlan.current)setError((e as Error).message);}
    finally{if(generation===currentPlan.current)setBusy(false);}
  }
  async function confirm(){
    if(!plan||confirmation!=='DELETE')return;setBusy(true);setError('');
    try{
      await api('/api/processing/cleanup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'confirm',id:plan.id,confirmation,pauseSchedules:pause})});
      setOpen(false);setPlan(null);setNotice(en?'Cleanup queued. The worker will remove local/S3 results and related records.':'已排入清除；worker 將清除本機、S3 成果與相關工作記錄。');await load();onChange();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function retry(id:string){
    setBusy(true);setError('');try{await api('/api/processing/cleanup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'retry',id})});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const size=(bytes:number)=>(bytes/1024/1024).toLocaleString(undefined,{maximumFractionDigits:2})+' MiB';
  return <section className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/30 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold">{en?'Clear processing results':'清除校正成果'}</h4><p className="mt-1 text-xs leading-6 text-slate-600">{en?'Uses the applied history filters across all pages. Up to 500 jobs per batch; running or uploading jobs are excluded.':'依已套用的工作記錄篩選，涵蓋所有分頁，每批最多 500 個工作；處理中與上傳中的工作會排除。'}</p></div><Button variant="destructive" disabled={busy} onClick={()=>void preview()}>{en?'Preview cleanup scope':'預覽清除範圍'}</Button></div>
    {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
    {!open&&error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    {data?.counts?.length>0&&<p className="text-xs">{data.counts.map((row:any)=>`${en?row.state:labels[row.state]} ${row.count}`).join(' · ')}</p>}
    {data?.tasks?.length>0&&<details><summary className="cursor-pointer text-sm">{en?'Recent cleanup activity':'最近清除記錄'}</summary><div className="mt-2 max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{(en?['Device / period','State','Details']:['設備／期間','清除狀態','說明']).map(label=><th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{data.tasks.map((task:any)=><tr key={task.id} className="border-t"><td className="p-2">{task.device}<span className="block">{formatTime(task.start)} → {formatTime(task.end)}</span></td><td className="p-2">{en?task.state:labels[task.state]}</td><td className="p-2"><p className="max-w-md whitespace-pre-wrap break-words text-rose-700">{task.last_error}</p>{task.state==='RETRY'&&<><span>{en?'Scheduled retry: ':'下次重試：'}{formatTime(new Date(task.retry_at).toISOString())}</span><Button className="ml-2" variant="outline" size="sm" disabled={busy} onClick={()=>void retry(task.id)}>{en?'Retry now':'立即重試'}</Button></>}{task.finished_at&&<span>{formatTime(task.finished_at)}</span>}</td></tr>)}</tbody></table></div></details>}
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{en?'Confirm processing result cleanup':'確認清除校正成果'}</DialogTitle><DialogDescription>{en?'This permanently removes selected processing files, all corresponding S3 versions, job/upload records and related query snapshots. Raw measurements, calibration coefficients and members are preserved.':'將永久刪除所選校正成果檔、對應 S3 所有版本、工作與上傳記錄及相關查詢快照；保留原始量測、校正係數與會員資料。'}</DialogDescription></DialogHeader>
      {busy&&!plan&&<p role="status">{en?'Inspecting local files and S3 versions…':'正在盤點本機檔案與 S3 版本…'}</p>}
      {error&&<p role="alert" className="whitespace-pre-wrap break-words text-sm text-rose-700">{error}</p>}
      {plan&&<>
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">{en?'Scope: ':'範圍：'}{plan.filters.device||(en?'All devices':'全部設備')} · {plan.filters.from||'…'} ～ {plan.filters.to||'…'} · {plan.filters.status||(en?'All statuses':'全部狀態')}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">{[
          [en?'Jobs':'工作數',plan.totals.jobs],[en?'Excluded jobs':'已排除工作',plan.totals.excluded],
          [en?'Local files / size':'本機檔案／大小',plan.totals.localFiles+' / '+size(plan.totals.localBytes)],
          [en?'S3 versions and markers / size':'S3 版本及刪除標記／大小',plan.totals.s3Versions+' / '+size(plan.totals.s3Bytes)],
        ].map(([label,value])=><div key={String(label)}><dt className="text-xs text-slate-500">{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className="max-h-48 overflow-auto rounded border"><table className="w-full text-left text-xs"><tbody>{plan.items.map((item:any)=><tr className="border-b" key={item.id}><td className="p-2">{item.device}</td><td className="p-2">{formatTime(item.start)} → {formatTime(item.end)}</td><td className="p-2">{item.localCount} local / {item.remoteCount} S3</td></tr>)}</tbody></table></div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={pause} disabled={busy} onChange={event=>setPause(event.target.checked)}/>{en?'Disable global scheduling and individual schedules for selected devices to prevent regeneration.':'停用全域排程與所選設備的單台排程，避免成果重新產生。'}</label>
        {!pause&&<p className="text-sm text-amber-800">{en?'Enabled schedules can create new results after cleanup.':'排程保持啟用時，清除後仍可能產生新成果。'}</p>}
        <p className="text-xs leading-6 text-slate-500">{en?'A database backup is created before queuing. A small cleanup audit and deletion marker are retained; downloaded ZIPs on your computer are not affected. Preview expires after 15 minutes.':'排入前會備份資料庫。清除後保留少量稽核記錄與刪除標記；電腦已下載的 ZIP 需自行刪除。預覽有效 15 分鐘。'}</p>
        <div><Label htmlFor="cleanup-confirm">{en?'Type DELETE to confirm':'輸入 DELETE 確認'}</Label><Input id="cleanup-confirm" value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)} autoComplete="off"/></div>
      </>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>{en?'Cancel':'取消'}</Button><Button variant="destructive" disabled={busy||!plan||confirmation!=='DELETE'} onClick={()=>void confirm()}>{busy?(en?'Working…':'處理中…'):(en?'Queue permanent cleanup':'確認永久清除')}</Button></div>
    </DialogContent></Dialog>
  </section>;
}
