"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
type Props={batches:any[];api:(path:string,options?:RequestInit)=>Promise<any>;isEnglish:boolean;formatTime:(s:string)=>string;onChange:()=>void};
const labels:Record<string,string>={RUNNING:'執行中',PAUSED:'已暫停',FAILED:'失敗，等待重試',CANCELLING:'取消中，已開始工作安全收尾',CANCELLED:'已取消',DONE:'已完成'};
export default function CleanupBatchProgress({batches,api,isEnglish:en,formatTime,onChange}:Props){
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[cancel,setCancel]=useState('');
 async function control(id:string,operation:string){setBusy(id);setError('');try{await api('/api/processing/cleanup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'control',id,operation})});setCancel('');onChange();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 if(!batches?.length)return null;
 return <section className="space-y-3 border-t pt-3"><h3 className="font-semibold">{en?'Cleanup batch progress':'批次清除進度'}</h3><p className="text-xs text-slate-600">{en?'Runs on the server worker. Closing this page does not stop it. Pause/cancel allow an already started task to finish safely; deleted files cannot be restored.':'由伺服器 worker 執行，關閉網頁仍會繼續。暫停／取消會讓已開始的單一工作安全收尾；已刪除檔案不會恢復。'}</p>
 {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
 {batches.map(batch=><article key={batch.plan_id} className="space-y-2 rounded-lg border bg-white p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{en?batch.state:labels[batch.state]||batch.state} · {batch.filters.kind==='raw'?(en?'Original archives':'原始封存'):(en?'Calibrated results':'校正成果')}</strong><span className="text-xs text-slate-500">{formatTime(batch.created_at)}</span></div>
 <p className="break-words text-xs">{batch.filters.devices?.length?batch.filters.devices.join(', '):batch.filters.device||(en?'All devices':'全部設備')} · {batch.filters.from||'…'} ～ {batch.filters.to||'…'}</p>
 <p>{en?`Batch ${batch.current_batch}/${batch.batches} · Deleted ${batch.done}/${batch.total} · Cancelled ${batch.cancelled} · Running ${batch.running} · Failed ${batch.failed}`:`第 ${batch.current_batch}／${batch.batches} 批 · 已清除 ${batch.done}／${batch.total} · 已取消 ${batch.cancelled} · 執行中 ${batch.running} · 失敗 ${batch.failed}`}</p>
 <progress className="h-3 w-full" max={batch.total||1} value={batch.done+batch.cancelled} aria-label={en?'Overall cleanup progress':'整體清除進度'}/>
 {batch.error&&<p role="alert" className="whitespace-pre-wrap break-words text-xs text-rose-700">{batch.error}</p>}
 <div className="flex flex-wrap gap-2">{batch.state==='RUNNING'&&<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void control(batch.plan_id,'pause')}>{en?'Pause':'暫停'}</Button>}{batch.state==='PAUSED'&&<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void control(batch.plan_id,'resume')}>{en?'Continue':'繼續'}</Button>}{batch.state==='FAILED'&&<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void control(batch.plan_id,'retry')}>{en?'Retry failed work':'重試失敗工作'}</Button>}{['RUNNING','PAUSED','FAILED'].includes(batch.state)&&!batch.cancel_requested&&<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>setCancel(batch.plan_id)}>{en?'Cancel remaining work':'取消剩餘工作'}</Button>}</div>
 {cancel===batch.plan_id&&<div role="alert" className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3"><p>{en?'Cancel all unstarted work? Started or partially deleted tasks must finish safely; failed started tasks still require retry. Deleted data will not be restored.':'確定取消所有尚未開始的工作？已開始或部分刪除的工作需安全收尾，失敗者仍需重試。已刪除資料不會恢復。'}</p><Button size="sm" variant="destructive" disabled={!!busy} onClick={()=>void control(batch.plan_id,'cancel')}>{en?'Confirm cancellation':'確認取消剩餘工作'}</Button><Button size="sm" variant="outline" disabled={!!busy} onClick={()=>setCancel('')}>{en?'Keep running':'保留工作'}</Button></div>}
 </article>)}
 </section>;
}
