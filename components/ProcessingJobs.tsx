"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {toast} from 'sonner';
import {DEFAULT_UP_LIMIT} from '@/lib/measurement-processing.mjs';
type Props={api:(path:string,options?:RequestInit)=>Promise<any>;isEnglish:boolean;formatTime:(s:string)=>string};
const labels:Record<string,string>={QUEUED:'排隊中',RUNNING:'處理中',COMPLETED:'已完成',FAILED:'失敗',DELETING:'清除中',CANCELLED:'已取消'};
export default function ProcessingJobs({api,isEnglish:en,formatTime}:Props){
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [device,setDevice]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[limit,setLimit]=useState(String(DEFAULT_UP_LIMIT));
  const requestId=useRef(0);
  const [globalLimit,setGlobalLimit]=useState(String(DEFAULT_UP_LIMIT)),[globalEdited,setGlobalEdited]=useState(false);
  const load=useCallback(async()=>{
    const current=++requestId.current;
    try{const result=await api('/api/processing?kind=processed&page=1&page_size=1');if(current===requestId.current){setData(result);setError('');}}
    catch(e){if(current===requestId.current)setError((e as Error).message);}
  },[api]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),15000);return()=>{clearInterval(timer);requestId.current++;};},[load]);
  useEffect(()=>{if(data?.global&&!globalEdited)setGlobalLimit(String(data.global.up_limit));},[data,globalEdited]);
  async function post(body:object){setBusy(true);try{await api('/api/processing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});toast.success(en?'Saved':'已儲存');await load();}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}
  const upLimit=limit.trim()===''?null:Number(limit),valid=upLimit!==null&&Number.isFinite(upLimit)&&upLimit>=0&&!!device.trim();
  return <section className="panel space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{en?'Background cleaning and calibration':'背景清理與校正'}</h2><Button variant="outline" onClick={()=>void load()}>{en?'Refresh':'重新整理'}</Button></div>
    <p className="text-xs leading-6 text-slate-500">{en?'Six rules · raw data preserved · Python breakpoint (<) · G3/GSA processed independently. A separate worker must be running. Results use compressed JSON Lines; CSV is streamed on download.':'六項規則；保留原始值；分段點使用 <；G3／GSA 分別處理。需啟動獨立 worker 才會執行工作。結果以壓縮 JSON Lines 儲存，下載時串流產生 CSV。'}</p>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-teal-900">{en?'Global automatic scheduling':'全域自動排程'} · {data?.global?.enabled?(en?'Enabled':'已啟用'):(en?'Disabled':'已停用')}</h3><div className="flex flex-wrap items-center gap-2"><Label htmlFor="global-process-limit">up_limit</Label><Input id="global-process-limit" className="w-24 bg-white" type="number" min="0" step="any" value={globalLimit} onChange={e=>{setGlobalLimit(e.target.value);setGlobalEdited(true);}}/><Button disabled={busy||!data?.global||globalLimit.trim()===''||!Number.isFinite(Number(globalLimit))||Number(globalLimit)<0} onClick={()=>void post({action:'global',enabled:!data?.global?.enabled,upLimit:Number(globalLimit)})}>{data?.global?.enabled?(en?'Disable global schedule':'停用全域排程'):(en?'Enable global schedule':'啟用全域排程')}</Button>{!!data?.global?.enabled&&<Button variant="outline" disabled={busy||globalLimit.trim()===''||!Number.isFinite(Number(globalLimit))||Number(globalLimit)<0} onClick={()=>void post({action:'global',enabled:true,upLimit:Number(globalLimit)})}>{en?'Save parameter':'儲存參數'}</Button>}</div></div>
      <p className="text-xs leading-6 text-teal-900">{en?'After 03:00 Taipei, process the last three completed days. Device parameters take priority. S3 mode also archives originals; missing coefficients skip only calibrated output. Configure monthly reconciliation and late-arrival detection in Archived data management.':'每日臺灣時間 03:00 後處理最近三個完整日；單台排程參數優先。S3 模式同時封存原始量測與校正成果，無係數者只封存原始值。每月補齊、舊日期補傳偵測及執行進度請至「封存資料管理」設定。'}</p>
      {data?.storage?.mode!=='s3'&&<p className="text-xs text-teal-900">{en?'Last check':'最近掃描'}：{data?.global?.last_check?formatTime(data.global.last_check):'—'} · {en?'Devices with data':'有資料設備'}：{data?.global?.summary?.devicesWithData??'—'} · {en?'Devices scheduled':'排入設備'}：{data?.global?.summary?.changedDevices??'—'} · {en?'Jobs':'工作數'}：{data?.global?.summary?.jobs??'—'}</p>}
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

    <p className="rounded-lg border bg-teal-50 p-4 text-sm">{en?'Archive lists, monthly reconciliation, late arrivals and cleanup have moved to a dedicated page.':'封存清單、每月補齊、補傳偵測及清除已移至獨立管理頁面。'} <a className="font-semibold underline" href="#archives">{en?'Open archived data management':'開啟封存資料管理'}</a></p>

  </section>;
}
