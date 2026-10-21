"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {toast} from 'sonner';
import {DEFAULT_UP_LIMIT} from '@/lib/measurement-processing.mjs';
import ProcessingJobDetails,{storageLabel} from '@/components/ProcessingJobDetails';
type Props={api:(path:string,options?:RequestInit)=>Promise<any>;isEnglish:boolean;formatTime:(s:string)=>string};
const labels:Record<string,string>={QUEUED:'排隊中',RUNNING:'處理中',COMPLETED:'已完成',FAILED:'失敗'};
export default function ProcessingJobs({api,isEnglish:en,formatTime}:Props){
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [device,setDevice]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[limit,setLimit]=useState(String(DEFAULT_UP_LIMIT));
  const [selected,setSelected]=useState('');
  const [filters,setFilters]=useState({device:'',from:'',to:'',status:''}),[draft,setDraft]=useState({device:'',from:'',to:'',status:''});
  const [page,setPage]=useState(1),[listLoading,setListLoading]=useState(false);
  const requestId=useRef(0);
  const [globalLimit,setGlobalLimit]=useState(String(DEFAULT_UP_LIMIT)),[globalEdited,setGlobalEdited]=useState(false);
  const load=useCallback(async(showLoading=true)=>{
    const current=++requestId.current;if(showLoading)setListLoading(true);
    try{const result=await api('/api/processing?'+new URLSearchParams({...filters,page:String(page),page_size:'20'}));if(current===requestId.current){setData(result);setError('');}}
    catch(e){if(current===requestId.current)setError((e as Error).message);}
    finally{if(current===requestId.current)setListLoading(false);}
  },[api,filters,page]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(false),15000);return()=>{clearInterval(timer);requestId.current++;};},[load]);
  useEffect(()=>{if(data?.global&&!globalEdited)setGlobalLimit(String(data.global.up_limit));},[data,globalEdited]);
  async function post(body:object){setBusy(true);try{await api('/api/processing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});toast.success(en?'Saved':'已儲存');await load();}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}
  const upLimit=limit.trim()===''?null:Number(limit),valid=upLimit!==null&&Number.isFinite(upLimit)&&upLimit>=0&&!!device.trim();
  return <section className="panel space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{en?'Background cleaning and calibration':'背景清理與校正'}</h2><Button variant="outline" onClick={()=>void load()}>{en?'Refresh':'重新整理'}</Button></div>
    <p className="text-xs leading-6 text-slate-500">{en?'Six rules · raw data preserved · Python breakpoint (<) · G3/GSA processed independently. A separate worker must be running. Results use compressed JSON Lines; CSV is streamed on download.':'六項規則；保留原始值；分段點使用 <；G3／GSA 分別處理。需啟動獨立 worker 才會執行工作。結果以壓縮 JSON Lines 儲存，下載時串流產生 CSV。'}</p>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-teal-900">{en?'Global automatic scheduling':'全域自動排程'} · {data?.global?.enabled?(en?'Enabled':'已啟用'):(en?'Disabled':'已停用')}</h3><div className="flex flex-wrap items-center gap-2"><Label htmlFor="global-process-limit">up_limit</Label><Input id="global-process-limit" className="w-24 bg-white" type="number" min="0" step="any" value={globalLimit} onChange={e=>{setGlobalLimit(e.target.value);setGlobalEdited(true);}}/><Button disabled={busy||!data?.global||globalLimit.trim()===''||!Number.isFinite(Number(globalLimit))||Number(globalLimit)<0} onClick={()=>void post({action:'global',enabled:!data?.global?.enabled,upLimit:Number(globalLimit)})}>{data?.global?.enabled?(en?'Disable global schedule':'停用全域排程'):(en?'Enable global schedule':'啟用全域排程')}</Button>{!!data?.global?.enabled&&<Button variant="outline" disabled={busy||globalLimit.trim()===''||!Number.isFinite(Number(globalLimit))||Number(globalLimit)<0} onClick={()=>void post({action:'global',enabled:true,upLimit:Number(globalLimit)})}>{en?'Save parameter':'儲存參數'}</Button>}</div></div>
      <p className="text-xs leading-6 text-teal-900">{en?'After 03:00 Taipei, automatically discover registered devices with new measurements and applicable coefficients. Process the last three completed days; today supplies context only. Online status is not required. Individually enabled schedules take priority. Older arrivals still require manual processing.':'每日臺灣時間 03:00 後，自動納入有新增量測資料且有適用係數的已登錄設備，不要求目前在線。處理最近三個完整日，當日資料僅協助判斷新增資料與背景更新；單台已啟用排程者優先使用單台設定。更早的補傳資料仍需手動建立工作。'}</p>
      <p className="text-xs text-teal-900">{en?'Last check':'最近掃描'}：{data?.global?.last_check?formatTime(data.global.last_check):'—'} · {en?'Devices with data':'有資料設備'}：{data?.global?.summary?.devicesWithData??'—'} · {en?'Devices scheduled':'排入設備'}：{data?.global?.summary?.changedDevices??'—'} · {en?'Jobs':'工作數'}：{data?.global?.summary?.jobs??'—'}</p>
      {data?.global?.last_error&&<p role="alert" className="text-xs text-rose-700">{data.global.last_error}</p>}
    </div>
    <div className="grid gap-3 md:grid-cols-4">
      <div><Label htmlFor="process-device">ASLUNG ID</Label><Input id="process-device" value={device} onChange={e=>setDevice(e.target.value)}/></div>
      <div><Label htmlFor="process-start">{en?'Start date (Taipei)':'開始日期（臺灣時間）'}</Label><Input id="process-start" type="date" value={start} onChange={e=>setStart(e.target.value)}/></div>
      <div><Label htmlFor="process-end">{en?'End date (exclusive)':'結束日期（不含當日）'}</Label><Input id="process-end" type="date" value={end} onChange={e=>setEnd(e.target.value)}/></div>
      <div><Label htmlFor="process-limit">{en?'Rule 6 up_limit (default: 3)':'第六項 up_limit（預設 3）'}</Label><Input id="process-limit" type="number" min="0" step="any" value={limit} onChange={e=>setLimit(e.target.value)}/></div>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy||!valid||!start||!end} onClick={()=>void post({action:'enqueue',device:device.trim(),start:start+'T00:00:00+08:00',end:end+'T00:00:00+08:00',upLimit})}>{en?'Queue processing':'建立校正工作'}</Button>
      <Button variant="outline" disabled={busy||!valid||!start||!end} onClick={()=>void post({action:'enqueue',device:device.trim(),start:start+'T00:00:00+08:00',end:end+'T00:00:00+08:00',upLimit,refresh:true})}>{en?'Queue new revision':'重新計算新版本'}</Button>
      <Button variant="outline" disabled={busy||!valid} onClick={()=>void post({action:'schedule',device:device.trim(),upLimit,enabled:true})}>{en?'Enable daily schedule':'啟用每日排程'}</Button>
    </div>
    <p className="text-xs leading-6 text-slate-500">{en?'Up to 31 days per request, split into daily jobs. Daily schedules run after 03:00 Taipei, refreshing the last three completed days; older corrections require an explicit new revision. Missing future context is flagged.':'每次最多 31 天，自動拆成每日工作。每日排程於臺灣時間 03:00 後更新最近三個完整日；更早的補傳資料或歷史係數修正，請使用「重新計算新版本」。未取得完整前後背景資料會留下標記。'}</p>
    <div className="flex flex-wrap gap-2">{data?.schedules.map((s:any)=><div key={s.device} className="rounded border p-2 text-xs">{s.device} · up_limit={s.up_limit} · {s.enabled?(en?'Daily enabled':'每日排程啟用'):(en?'Disabled':'已停用')}{s.last_error&&<p className="text-rose-700">{s.last_error}</p>} <Button size="sm" variant="ghost" disabled={busy} onClick={()=>void post({action:'schedule',device:s.device,upLimit:s.up_limit,enabled:!s.enabled})}>{s.enabled?(en?'Disable':'停用'):(en?'Enable':'啟用')}</Button></div>)}</div>
    <section className="space-y-3 border-t pt-4">
      <div><h3 className="font-semibold">{en?'Processing history':'校正工作記錄'}</h3><p className="mt-1 text-xs text-slate-500">{en?'Inspect status and versions here. Use Data Query for period queries and bulk downloads.':'此處供管理員追蹤工作、品質與版本；期間查詢及批量下載請至「資料查詢」。'}</p></div>
      <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={event=>{event.preventDefault();setFilters({...draft,device:draft.device.trim()});setPage(1);}}>
        <div><Label htmlFor="history-device">ASLUNG ID</Label><Input id="history-device" placeholder={en?'All devices':'全部設備'} value={draft.device} onChange={e=>setDraft({...draft,device:e.target.value})}/></div>
        <div><Label htmlFor="history-from">{en?'From (Taipei)':'開始日期（臺灣）'}</Label><Input id="history-from" type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></div>
        <div><Label htmlFor="history-to">{en?'Through (Taipei)':'結束日期（含當日）'}</Label><Input id="history-to" type="date" value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></div>
        <div><Label htmlFor="history-status">{en?'Status':'工作狀態'}</Label><select id="history-status" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}><option value="">{en?'All statuses':'全部狀態'}</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{en?key:label}</option>)}</select></div>
        <div className="flex gap-2"><Button type="submit" disabled={listLoading}>{en?'Filter':'篩選'}</Button><Button type="button" variant="outline" disabled={listLoading} onClick={()=>{const empty={device:'',from:'',to:'',status:''};setDraft(empty);setFilters(empty);setPage(1);}}>{en?'Reset':'重設'}</Button></div>
      </form>
      <p className="text-xs text-slate-500">{en?'Dates filter the processing period, not the creation time.':'日期依工作處理期間篩選，非建立時間。'}</p>
      {listLoading&&<p role="status" className="text-sm">{en?'Loading history…':'正在載入工作記錄…'}</p>}
      <div className="max-h-[32rem] overflow-auto" aria-busy={listLoading}><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-white"><tr>{(en?['Device / period','Status','Rows','Actions']:['設備／期間','狀態','筆數','操作']).map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{data?.jobs.map((job:any)=><tr key={job.id} className="border-t"><td className="p-3">{job.device}<span className="block text-xs text-slate-500">{formatTime(job.start)} → {formatTime(job.end)}</span></td><td className="p-3">{en?job.status:labels[job.status]}{job.status==='COMPLETED'&&<span className={'mt-1 block text-xs '+(job.upload_status==='RETRY'?'text-amber-700':'text-slate-500')}>{storageLabel(job.upload_status,en)}</span>}</td><td className="p-3">{job.rows_done}</td><td className="p-3"><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={()=>setSelected(job.id)}>{en?'Details':'詳細資料'}</Button>{job.status==='FAILED'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void post({action:'retry',id:job.id})}>{en?'Retry':'重試'}</Button>}</div></td></tr>)}</tbody></table>{!listLoading&&!data?.jobs.length&&<p className="py-4 text-sm text-slate-500">{en?'No matching processing jobs.':'沒有符合條件的校正工作。'}</p>}</div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{en?`${data?.pagination?.total??0} jobs · Page ${data?.pagination?.page??1} / ${data?.pagination?.pages??1}`:`共 ${data?.pagination?.total??0} 筆工作 · 第 ${data?.pagination?.page??1}／${data?.pagination?.pages??1} 頁`}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={listLoading||!data||data.pagination.page<=1} onClick={()=>setPage(data.pagination.page-1)}>{en?'Previous':'上一頁'}</Button><Button size="sm" variant="outline" disabled={listLoading||!data||data.pagination.page>=data.pagination.pages} onClick={()=>setPage(data.pagination.page+1)}>{en?'Next':'下一頁'}</Button></div></div>
    </section>
    {selected&&<ProcessingJobDetails key={selected} id={selected} api={api} isEnglish={en} formatTime={formatTime} onClose={()=>setSelected('')}/>}
  </section>;
}
