"use client";
import {useState} from "react";
import {Search,TriangleAlert} from "lucide-react";
import {Button} from "@/components/ui/button";

type Reading={aslung_id:string;timestamp:string;[key:string]:any};
type ResultProps={rows:Reading[];formatTime:(value:string)=>string;onRegister:(id:string)=>void;registeredIds:string[];busy?:boolean};
type Props=Omit<ResultProps,'rows'|'busy'>&{api:(url:string)=>Promise<any>;onResults:(rows:Reading[])=>void};
export function RealtimeDiscoveryResults({rows,formatTime,onRegister,registeredIds,busy=false}:ResultProps){
  const known=new Set(registeredIds);
  if(!rows.length)return null;
  return <div className="mt-4 overflow-hidden rounded-lg border border-teal-100 bg-white">
    <div className="border-b border-teal-100 px-4 py-3"><h3 className="text-sm font-semibold text-teal-900">本次搜尋找到的設備 <span className="font-normal">（{rows.length} 台）</span></h3><p className="mt-1 text-xs text-slate-500">搜尋結果獨立顯示，不受下方總清單的搜尋條件影響。補登後仍保留在此供核對。</p></div>
    <div className="max-h-80 overflow-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr>{['ASLUNG ID','狀態','最後回報時間','PM1_G3','PM2.5_G3','PM10_G3','溫度','濕度','CO₂','操作'].map(h=><th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{rows.map(row=>{
      const age=Date.now()-Date.parse(row.timestamp),valid=Number.isFinite(age)&&age>=0;
      return <tr key={row.aslung_id} className="border-t border-slate-100"><td className="px-4 py-3 font-mono font-medium">{row.aslung_id}<span className={'ml-2 rounded px-1.5 py-0.5 font-sans text-[10px] '+(known.has(row.aslung_id)?'bg-slate-100 text-slate-500':'bg-amber-50 text-amber-800')}>{known.has(row.aslung_id)?'已建檔':'未建檔'}</span></td><td className="px-4 py-3"><span className={valid&&age<=3600000?'status ok':'status pending'}>{!valid?'無法確認':age>3600000?'已斷線':'連線中'}</span></td><td className="px-4 py-3 font-mono">{formatTime(row.timestamp)}</td>{['PM1_G3','PM2.5_G3','PM10_G3','temperature','rh','co2'].map(key=><td key={key} className="px-4 py-3">{String(row[key]??'—')}</td>)}<td className="px-4 py-3">{known.has(row.aslung_id)?<span className="text-slate-400">已完成補登</span>:<Button size="sm" variant="outline" disabled={busy} onClick={()=>onRegister(row.aslung_id)}>補登設備</Button>}</td></tr>;
    })}</tbody></table></div>
  </div>;
}
export default function RealtimeDiscovery({api,onResults,formatTime,onRegister,registeredIds}:Props){
  const [days,setDays]=useState('7'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [rows,setRows]=useState<Reading[]>([]);
  async function search(){
    setBusy(true);setError('');
    try{
      const result=await api(`/api/realtime/discover?days=${days}`);setRows(result.devices);onResults(result.devices);
      setMessage(`近 ${result.days} 天找到 ${result.devices.length} 台未建檔設備。${result.truncated?`結果超過 ${result.limit} 台，先顯示前 ${result.limit} 台，請縮小期間。`:''}${result.failedCount?`另有 ${result.failedCount} 台最新資料查詢失敗。`:''}`);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="mb-4 rounded-lg border border-teal-100 bg-teal-50/50 p-4"><div className="flex flex-wrap items-center gap-3"><div className="min-w-48 flex-1"><strong className="text-sm text-teal-900">找出尚未補登的設備</strong><p className="mt-1 text-xs leading-5 text-slate-500">直接搜尋量測資料庫有回報的設備，先查看即時數據，再補登部署資料。不會自動建立設備或開放會員權限。</p></div><select aria-label="未建檔設備搜尋期間" className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs" value={days} disabled={busy} onChange={e=>setDays(e.target.value)}>{[1,7,30,365].map(day=><option key={day} value={day}>近 {day} 天</option>)}</select><Button variant="outline" disabled={busy} onClick={()=>void search()}><Search size={14}/>{busy?'搜尋量測資料中…':'搜尋未建檔設備'}</Button></div>{message&&<p role="status" className="mt-3 text-xs text-teal-800">{message}</p>}{error&&<p role="alert" className="mt-3 flex gap-2 text-xs text-rose-700"><TriangleAlert size={14}/>{error}</p>}<RealtimeDiscoveryResults rows={rows} formatTime={formatTime} onRegister={onRegister} registeredIds={registeredIds} busy={busy}/></div>;
}
