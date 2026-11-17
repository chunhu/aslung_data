"use client";
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import ProcessingJobDetails,{storageLabel} from '@/components/ProcessingJobDetails';
import ProcessingHistoryImport from '@/components/ProcessingHistoryImport';
import ProcessingCleanup from '@/components/ProcessingCleanup';
import ArchiveAutomationSettings from '@/components/ArchiveAutomationSettings';
type Props={api:(path:string,options?:RequestInit)=>Promise<any>;isEnglish:boolean;formatTime:(s:string)=>string};
const labels:Record<string,string>={QUEUED:'排隊中',RUNNING:'處理中',COMPLETED:'已完成',FAILED:'失敗',DELETING:'清除中',CANCELLED:'已取消'};
export default function ArchiveManagement({api,isEnglish:en,formatTime}:Props){
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState('');
 const [filters,setFilters]=useState({device:'',from:'',to:'',status:'',kind:'raw'}),[draft,setDraft]=useState({...filters}),[page,setPage]=useState(1),[listLoading,setListLoading]=useState(false);
 const requestId=useRef(0);
 const load=useCallback(async(showLoading=true)=>{const current=++requestId.current;if(showLoading)setListLoading(true);try{const result=await api('/api/processing?'+new URLSearchParams({...filters,device:'',q:filters.device,page:String(page),page_size:'20'}));if(current===requestId.current){setData(result);setError('');}}catch(e){if(current===requestId.current)setError((e as Error).message);}finally{if(current===requestId.current)setListLoading(false);}},[api,filters,page]);
 useEffect(()=>{void load();const timer=setInterval(()=>void load(false),15000);return()=>{clearInterval(timer);requestId.current++;};},[load]);
 async function post(body:object){setBusy(true);try{await api('/api/processing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const cleanupScope=useMemo(()=>({...filters,...(filters.device&&data?.devices?.some((id:string)=>id.toLowerCase().includes(filters.device.toLowerCase()))?{device:'',devices:data.devices.filter((id:string)=>id.toLowerCase().includes(filters.device.toLowerCase()))}:{device:filters.device})}),[filters,data?.devices?.join('|')]);
 return <section className="panel space-y-5 p-5">
 <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{en?'Archived data management':'封存資料管理'}</h2><Button variant="outline" onClick={()=>void load()}>{en?'Refresh archive list':'重新整理封存清單'}</Button></div>
 <p className="text-sm text-slate-600">{en?'Manage daily, monthly and manual archives in one place. Read measurements and download periods in Data Query.':'統一管理每日排程、每月補齊與手動封存的每日檔案。量測數值查詢及期間下載請至「資料查詢」。'}</p>
 {error&&<p role="alert" className="text-rose-700">{error}</p>}
 <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">{en?'Automatic archive schedule and progress':'自動封存排程與進度'}</summary><div className="mt-4"><ArchiveAutomationSettings api={api} isEnglish={en} formatTime={formatTime}/></div></details>
    <section className="space-y-3 border-t pt-4">
      <div><h3 className="font-semibold">{en?'Archive list':'封存資料清單'}</h3><p className="mt-1 text-xs text-slate-500">{en?'Inspect status and versions here. Use Data Query for period queries and bulk downloads.':'此處供管理員追蹤工作、品質與版本；期間查詢及批量下載請至「資料查詢」。'}</p></div>
      <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={event=>{event.preventDefault();setFilters({...draft,device:draft.device.trim()});setPage(1);}}>
        <div><Label htmlFor="history-kind">{en?'Data type':'資料類型'}</Label><select id="history-kind" className="h-10 w-full rounded border bg-white px-2" value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value})}><option value="processed">{en?'Calibrated results':'校正成果'}</option><option value="raw">{en?'Original archives':'原始量測封存'}</option></select></div>
        <div><Label htmlFor="history-device">{en?'Device keyword':'設備關鍵字'}</Label><Input id="history-device" maxLength={80} placeholder={en?'e.g. AL-05 (partial ID)':'例如 AL-05，支援部分 ID'} value={draft.device} onChange={e=>setDraft({...draft,device:e.target.value})}/></div>
        <div><Label htmlFor="history-from">{en?'From (Taipei)':'開始日期（臺灣）'}</Label><Input id="history-from" type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></div>
        <div><Label htmlFor="history-to">{en?'Through (Taipei)':'結束日期（含當日）'}</Label><Input id="history-to" type="date" value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></div>
        <div><Label htmlFor="history-status">{en?'Status':'工作狀態'}</Label><select id="history-status" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}><option value="">{en?'All statuses':'全部狀態'}</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{en?key:label}</option>)}</select></div>
        <div className="flex gap-2"><Button type="submit" disabled={listLoading}>{en?'Filter':'篩選'}</Button><Button type="button" variant="outline" disabled={listLoading} onClick={()=>{const empty={device:'',from:'',to:'',status:'',kind:'raw'};setDraft(empty);setFilters(empty);setPage(1);}}>{en?'Reset':'重設'}</Button></div>
      </form>
      <p className="text-xs text-slate-500">{en?'Device keywords match part of the ID, ignoring case; dates match the job period, not creation time.':'設備關鍵字支援部分 ID、不分大小寫；日期依工作處理期間篩選，非建立時間。'}</p>
      <ProcessingCleanup api={api} devices={data?.devices||[]} filters={cleanupScope} isEnglish={en} formatTime={formatTime} onChange={()=>void load()}/>
      {listLoading&&<p role="status" className="text-sm">{en?'Loading history…':'正在載入工作記錄…'}</p>}
      <div className="max-h-[32rem] overflow-auto" aria-busy={listLoading}><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-white"><tr>{(en?['Device / period','Status','Rows','Actions']:['設備／期間','狀態','筆數','操作']).map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{data?.jobs.map((job:any)=><tr key={job.id} className="border-t"><td className="p-3">{job.device}<span className="block text-xs text-slate-500">{formatTime(job.start)} → {formatTime(job.end)}</span></td><td className="p-3">{en?job.status:labels[job.status]}{job.status==='COMPLETED'&&<span className={'mt-1 block text-xs '+(job.upload_status==='RETRY'?'text-amber-700':'text-slate-500')}>{storageLabel(job.upload_status,en)}</span>}</td><td className="p-3">{job.rows_done}</td><td className="p-3"><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={()=>setSelected(job.id)}>{en?'Details':'詳細資料'}</Button>{job.status==='FAILED'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void post({action:'retry',id:job.id})}>{en?'Retry':'重試'}</Button>}</div></td></tr>)}</tbody></table>{!listLoading&&!data?.jobs.length&&<p className="py-4 text-sm text-slate-500">{en?'No matching processing jobs.':'沒有符合條件的封存工作。'}</p>}</div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{en?`${data?.pagination?.total??0} jobs · Page ${data?.pagination?.page??1} / ${data?.pagination?.pages??1}`:`共 ${data?.pagination?.total??0} 筆工作 · 第 ${data?.pagination?.page??1}／${data?.pagination?.pages??1} 頁`}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={listLoading||!data||data.pagination.page<=1} onClick={()=>setPage(data.pagination.page-1)}>{en?'Previous':'上一頁'}</Button><Button size="sm" variant="outline" disabled={listLoading||!data||data.pagination.page>=data.pagination.pages} onClick={()=>setPage(data.pagination.page+1)}>{en?'Next':'下一頁'}</Button></div></div>
    </section>
<details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">{en?'Manual backfill / recalculate':'手動補封存／重新計算'}</summary><div className="mt-4"><ProcessingHistoryImport api={api} isEnglish={en} s3={data?.storage?.mode==='s3'} devices={data?.devices||[]} batches={data?.historical||[]} onChange={kind=>{setFilters(old=>({...old,kind}));setDraft(old=>({...old,kind}));setPage(1);void load();}}/></div></details>    {selected&&<ProcessingJobDetails key={selected} id={selected} api={api} isEnglish={en} formatTime={formatTime} onClose={()=>setSelected('')}/>}
 </section>;
}
