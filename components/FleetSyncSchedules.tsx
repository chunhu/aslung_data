"use client";
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import FleetScheduleEditor from '@/components/FleetScheduleEditor';
function Schedule({source,save}:{source:any;save:(p:any)=>Promise<void>}){
  const [enabled,setEnabled]=useState(!!source.enabled),[schedule,setSchedule]=useState({scheduleType:source.schedule_type||'interval',scheduleTime:source.schedule_time||'02:00',scheduleDays:source.schedule_days||'1,2,3,4,5',intervalMins:String(source.interval_mins)}),[busy,setBusy]=useState(false);
  const label=source.schedule_type==='daily'?`每天 ${source.schedule_time}`:source.schedule_type==='weekly'?`每週${source.schedule_days.split(',').map((day:string)=>'日一二三四五六'[Number(day)]).join('、')} ${source.schedule_time}`:`每 ${source.interval_mins} 分鐘`;
  return <form className="space-y-2 rounded border p-3 text-xs" onSubmit={e=>{e.preventDefault();setBusy(true);void save({action:'scheduleSettings',id:source.id,revision:source.revision,enabled,...schedule,intervalMins:Number(schedule.intervalMins)}).finally(()=>setBusy(false));}}>
    <a href={source.url} target="_blank" rel="noreferrer" className="block break-all text-teal-700 underline">{source.url}</a>
    <label><input type="checkbox" checked={enabled} disabled={busy} onChange={e=>setEnabled(e.target.checked)}/>啟用定期同步</label>
    <FleetScheduleEditor value={schedule} onChange={setSchedule} disabled={busy}/>
    <Button type="submit" variant="outline" size="sm" disabled={busy}>{busy?'儲存中…':'儲存排程'}</Button>
    <p>目前設定：{source.enabled?label:'已停用'} · 下次同步：{source.enabled?new Date(source.next_check).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})+'（臺灣時間）':'—'}</p>
    <p className={source.last_status==='FAILED'?'whitespace-pre-wrap text-rose-700':'text-slate-500'}>最後結果：{source.last_message||'尚未執行'}{source.last_check?' · '+new Date(source.last_check).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):''}</p>
  </form>;
}
export default function FleetSyncSchedules({api,onSaved}:{api:(url:string,init?:RequestInit)=>Promise<any>;onSaved?:()=>void}){
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=useCallback(async()=>{try{setData(await api('/api/fleet?sync=1'));}catch(e){setError((e as Error).message);}},[api]);
  useEffect(()=>{void load();},[load]);
  async function save(p:any){setError('');setNotice('');try{await api('/api/fleet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});setNotice('排程已儲存');await load();onSaved?.();}catch(e){setError((e as Error).message);}}
  return <details className="rounded border p-3"><summary className="cursor-pointer text-sm">管理既有定期同步排程（{data?.sources.length||0}）</summary><div className="mt-3 space-y-3">{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}{notice&&<p role="status" className="text-xs text-teal-700">{notice}</p>}{data?.sources.map((s:any)=><Schedule key={s.id+':'+s.revision} source={s} save={save}/>)}{data&&!data.sources.length&&<p className="text-xs text-slate-500">尚未儲存 Google 試算表排程。確認匯入時可一併儲存週期設定。</p>}<details><summary className="text-xs">最近同步與設定紀錄</summary><div className="max-h-40 overflow-auto text-xs">{data?.runs.map((r:any)=><p className="my-2 whitespace-pre-wrap" key={r.id}>{new Date(r.created_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})} · {r.status} · {r.message}</p>)}</div></details></div></details>;
}
