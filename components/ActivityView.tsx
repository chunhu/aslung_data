"use client";
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
type Props={api:(url:string,options?:RequestInit)=>Promise<any>;isEnglish:boolean;formatTime:(time:string)=>string};
export default function ActivityView({api,isEnglish:en,formatTime}:Props){
  const [kind,setKind]=useState(''),[q,setQ]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
  const sequence=useRef(0),controller=useRef<AbortController|null>(null);
  async function load(parameters:string,before?:number){
    controller.current?.abort();controller.current=new AbortController();const id=++sequence.current;setBusy(true);setError('');
    try{
      const params=new URLSearchParams(parameters);if(before)params.set('before',String(before));
      const result=await api('/api/activity?'+params,{signal:controller.current.signal});if(id!==sequence.current)return;
      setData((previous:any)=>before?{...result,rows:[...previous.rows,...result.rows]}:result);
    }catch(e){if(id===sequence.current&&(e as Error).name!=='AbortError')setError((e as Error).message);}
    finally{if(id===sequence.current)setBusy(false);}
  }
  useEffect(()=>{void load('');return()=>{sequence.current++;controller.current?.abort();};},[]);
  return <section className="panel p-6 space-y-4">
    <p className="text-sm text-slate-600">{en?'Administrator access only. Detail records are retained for 90 days; daily aggregates remain. Dates use Taiwan time. Downloads record the response being opened, not completion.':'僅系統管理員可查看。明細保留 90 天，每日彙總持續保留。查詢日期使用臺灣時間；下載紀錄代表已開啟下載回應，不保證已完整下載。'}</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();const params=new URLSearchParams({kind,q,from,to});setQuery(params.toString());void load(params.toString());}}>
      <label className="text-sm">{en?'Type':'紀錄類型'}<select className="block h-10 rounded border px-2" value={kind} onChange={event=>setKind(event.target.value)}><option value="">{en?'All':'全部'}</option>{[['auth','登入與密碼','Authentication'],['visit','頁面瀏覽','Page views'],['operation','重要操作','Operations'],['download','下載','Downloads']].map(([value,zh,label])=><option key={value} value={value}>{en?label:zh}</option>)}</select></label>
      <label className="text-sm">{en?'From':'開始日期'}<Input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label className="text-sm">{en?'To':'結束日期'}<Input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label>
      <label className="text-sm">{en?'Member, event or IP':'會員、事件或 IP'}<Input value={q} maxLength={160} onChange={event=>setQ(event.target.value)}/></label><Button disabled={busy}>{en?'Search':'查詢紀錄'}</Button>
    </form>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    {data&&<>
      <p className="text-xs text-slate-500">{data.from} – {data.to} · {en?'Records shown':'已載入'} {data.rows.length} · {en?'Recording started':'新版紀錄開始時間'} {data.startedAt?formatTime(data.startedAt):'—'}</p>
      <div className="overflow-auto max-h-[36rem]"><table className="w-full text-left text-xs whitespace-nowrap"><thead className="sticky top-0 bg-slate-50"><tr>{(en?['Time','Type','Event','Member','Target','Result','IP','Browser']:['時間','類型','事件','會員','對象／頁面','結果','IP','瀏覽器']).map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{data.rows.map((row:any)=><tr key={row.id} className="border-t"><td className="p-3">{formatTime(row.created_at)}</td><td>{row.kind}</td><td className="p-3">{row.event}</td><td>{row.actor||'—'}</td><td className="p-3">{row.target||'—'}</td><td>{row.outcome==='success'?(en?'Success':'成功'):(en?'Failed':'失敗')}</td><td className="p-3">{row.ip||'—'}</td><td className="max-w-56 truncate" title={row.user_agent}>{row.user_agent||'—'}</td></tr>)}</tbody></table></div>
      {!data.rows.length&&<p>{en?'No matching records.':'查無符合紀錄。'}</p>}
      {data.next!==null&&<Button variant="outline" disabled={busy} onClick={()=>void load(query,data.next)}>{en?'Load more':'載入更多'}</Button>}
      <details className="text-sm"><summary>{en?'Daily summary':'每日彙總'}</summary><div className="max-h-60 overflow-auto mt-3"><table><tbody>{data.daily.map((row:any)=><tr key={[row.day,row.kind,row.event].join(':')}><td className="pr-4">{row.day}</td><td className="pr-4">{row.kind} / {row.event}</td><td>{row.count}</td></tr>)}</tbody></table></div></details>
    </>}
    {busy&&<p role="status">{en?'Loading…':'載入中…'}</p>}
  </section>;
}
