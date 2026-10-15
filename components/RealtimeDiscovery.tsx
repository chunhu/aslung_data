"use client";
import {useState} from "react";
import {Search,TriangleAlert} from "lucide-react";
import {Button} from "@/components/ui/button";

type Props={api:(url:string)=>Promise<any>;onResults:(rows:any[])=>void};
export default function RealtimeDiscovery({api,onResults}:Props){
  const [days,setDays]=useState('7'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  async function search(){
    setBusy(true);setError('');
    try{
      const result=await api(`/api/realtime/discover?days=${days}`);onResults(result.devices);
      setMessage(`近 ${result.days} 天找到 ${result.devices.length} 台未建檔設備。${result.truncated?`結果超過 ${result.limit} 台，先顯示前 ${result.limit} 台，請縮小期間。`:''}${result.failedCount?`另有 ${result.failedCount} 台最新資料查詢失敗。`:''}`);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="mb-4 rounded-lg border border-teal-100 bg-teal-50/50 p-4"><div className="flex flex-wrap items-center gap-3"><div className="min-w-48 flex-1"><strong className="text-sm text-teal-900">找出尚未補登的設備</strong><p className="mt-1 text-xs leading-5 text-slate-500">直接搜尋量測資料庫有回報的設備，先查看即時數據，再補登部署資料。不會自動建立設備或開放會員權限。</p></div><select aria-label="未建檔設備搜尋期間" className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs" value={days} disabled={busy} onChange={e=>setDays(e.target.value)}>{[1,7,30,365].map(day=><option key={day} value={day}>近 {day} 天</option>)}</select><Button variant="outline" disabled={busy} onClick={()=>void search()}><Search size={14}/>{busy?'搜尋量測資料中…':'搜尋未建檔設備'}</Button></div>{message&&<p role="status" className="mt-3 text-xs text-teal-800">{message}</p>}{error&&<p role="alert" className="mt-3 flex gap-2 text-xs text-rose-700"><TriangleAlert size={14}/>{error}</p>}</div>;
}
