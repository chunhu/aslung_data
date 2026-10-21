"use client";
import {useEffect,useState} from 'react';
import {formatInTimeZone} from 'date-fns-tz';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import HoboCancelSync from '@/components/HoboCancelSync';
type Props={api:(url:string,options?:RequestInit)=>Promise<any>;jobs:any[];timezone:string;onChange:()=>void};
type Confirmation={operation:'cancel'|'delete';ids:string[];serials:string[]};
const labels:Record<string,string>={QUEUED:'排隊中',RUNNING:'同步中',DONE:'已完成',FAILED:'失敗',CANCELLED:'已取消'};
export default function HoboSyncJobs({api,jobs,timezone,onChange}:Props){
  const [selected,setSelected]=useState<Set<string>>(new Set()),[dialog,setDialog]=useState<Confirmation|null>(null),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{const ids=new Set(jobs.map(job=>job.id));setSelected(previous=>{const next=new Set([...previous].filter(id=>ids.has(id)));return next.size===previous.size?previous:next;});},[jobs]);
  const chosen=jobs.filter(job=>selected.has(job.id));
  const cancelable=chosen.filter(job=>['QUEUED','RUNNING','FAILED'].includes(job.status));
  const active=chosen.some(job=>['QUEUED','RUNNING'].includes(job.status));
  const all=jobs.length>0&&jobs.every(job=>selected.has(job.id));
  function toggle(id:string,checked:boolean){setSelected(previous=>{const next=new Set(previous);if(checked)next.add(id);else next.delete(id);return next;});}
  function preview(operation:'cancel'|'delete',items=chosen){setError('');setNotice('');setConfirmation('');setDialog({operation,ids:items.map(job=>job.id),serials:[...new Set(items.map(job=>String(job.serial)))]});}
  async function confirm(){
    if(!dialog||(dialog.operation==='delete'&&confirmation!=='DELETE'))return;
    setBusy(true);setError('');
    try{
      const result=await api('/api/hobo',{method:'POST',body:JSON.stringify({action:'jobsBulk',operation:dialog.operation,ids:dialog.ids,confirmation:dialog.operation==='delete'?'DELETE':'CANCEL'})});
      setNotice(dialog.operation==='delete'?`已刪除 ${result.deleted} 筆工作紀錄，量測資料仍保留。`:`已取消 ${result.cancelled} 筆工作，略過 ${result.skipped} 筆已完成或已取消工作；已停用被取消設備的自動同步。`);
      setSelected(new Set());setDialog(null);onChange();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function retry(id:string){setBusy(true);setError('');try{await api('/api/hobo',{method:'POST',body:JSON.stringify({action:'retry',id})});onChange();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="panel p-6 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">同步工作（最近 30 筆）</h3><div className="flex flex-wrap gap-2 items-center"><span className="text-sm">已選 {chosen.length} 筆</span><Button variant="outline" disabled={busy||!cancelable.length} onClick={()=>preview('cancel')}>批量取消</Button><Button variant="destructive" disabled={busy||!chosen.length||active} onClick={()=>preview('delete')}>批量刪除紀錄</Button></div></div>
    <p className="text-xs text-slate-500">全選只涵蓋目前清單的最近 30 筆工作。刪除紀錄保留本機及 S3 量測資料；要刪除量測資料，請使用「清除 HOBO 資料」。{active&&<span className="text-amber-800"> 所選工作包含排隊或執行中項目，請先批量取消，再刪除。</span>}</p>
    {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}{!dialog&&error&&<p role="alert" className="text-rose-700">{error}</p>}
    <div className="max-h-96 overflow-auto"><table className="w-full text-sm text-left"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2"><input type="checkbox" aria-label="全選目前同步工作" disabled={busy||!jobs.length} checked={all} onChange={e=>setSelected(e.target.checked?new Set(jobs.map(job=>job.id)):new Set())}/></th>{['設備','UTC 範圍','狀態','已抓取筆數（含重疊）','進度 / 錯誤','操作'].map(label=><th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{jobs.map(job=><tr key={job.id} className="border-t"><td className="p-2"><input type="checkbox" aria-label={`選擇同步工作 ${job.serial} ${job.id}`} disabled={busy} checked={selected.has(job.id)} onChange={e=>toggle(job.id,e.target.checked)}/></td><td className="p-2">{job.serial}</td><td>{job.start}<br/>{job.end}</td><td>{labels[job.status]||job.status}</td><td>{job.observations}</td><td>{job.months>0&&<p>月份進度：{job.months_done}/{job.months}</p>}{job.month_start&&<p className="text-xs">目前月份（臺灣時間）：{formatInTimeZone(new Date(job.month_start),'Asia/Taipei','yyyy/MM/dd HH:mm')} → {formatInTimeZone(new Date(job.month_end),'Asia/Taipei','yyyy/MM/dd HH:mm')}</p>}<p>已完成至：{job.cursor}</p>{job.status==='QUEUED'&&job.next_attempt>Date.now()&&<p className="text-xs">等待至 {formatInTimeZone(new Date(job.next_attempt),timezone,'yyyy/MM/dd HH:mm:ss')} 後續傳</p>}<span className="text-rose-700">{job.error}</span></td><td><div className="flex flex-wrap gap-2">{job.status==='FAILED'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void retry(job.id)}>重試</Button>}<HoboCancelSync api={api} job={job} onChange={onChange}/>{!['QUEUED','RUNNING'].includes(job.status)&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>preview('delete',[job])}>刪除紀錄</Button>}</div></td></tr>)}</tbody></table>{!jobs.length&&<p className="p-4 text-sm text-slate-500">尚無同步工作。</p>}</div>
    <Dialog open={!!dialog} onOpenChange={open=>{if(!open&&!busy)setDialog(null);}}><DialogContent><DialogHeader><DialogTitle>{dialog?.operation==='delete'?'刪除所選同步工作紀錄？':'取消所選同步工作？'}</DialogTitle><DialogDescription>{dialog?.operation==='delete'?'永久移除所選工作與月份進度紀錄；保留設備設定、本機及 S3 量測資料。':'停止所選工作後續下載與重試，並停用對應設備的自動同步。保留已下載資料；已完成或已取消工作會略過。'}</DialogDescription></DialogHeader>
      {dialog&&<><p>工作 {dialog.ids.length} 筆／設備 {dialog.serials.length} 台</p><p className="text-sm break-words">{dialog.serials.join('、')}</p>{dialog.operation==='delete'&&<label className="text-sm">輸入 DELETE 確認刪除工作紀錄<Input value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></label>}</>}
      {error&&<p role="alert" className="text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setDialog(null)}>返回</Button><Button variant="destructive" disabled={busy||!dialog||(dialog.operation==='delete'&&confirmation!=='DELETE')} onClick={()=>void confirm()}>{busy?'處理中…':dialog?.operation==='delete'?'確認刪除紀錄':'確認批量取消'}</Button></div>
    </DialogContent></Dialog>
  </section>;
}
