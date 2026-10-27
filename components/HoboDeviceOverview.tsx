"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';

type SyncState={serial:string;enabled?:number|boolean;interval_minutes?:number;active_job_status?:string|null};
type Logger=SyncState&{serial:string;name:string;observations:number;archived:number;first?:string|null;latest?:string|null;first_error?:string};
type Props={api:(url:string,options?:RequestInit)=>Promise<any>;loggers:SyncState[];selectedSerial:string;onSelect:(serial:string)=>void;refreshKey:number};
export default function HoboDeviceOverview({api,loggers,selectedSerial,onSelect,refreshKey}:Props){
  const [expanded,setExpanded]=useState(false),[result,setResult]=useState<{loggers:Logger[];generated_at:string}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const liveStates=new Map(loggers.map(logger=>[logger.serial,logger]));
  const syncState=(logger:Logger)=>liveStates.get(logger.serial)||logger;
  const workLabel=(logger:Logger)=>({RUNNING:'同步中',QUEUED:'排隊中'}[syncState(logger).active_job_status||'']||'目前無執行工作');
  const deviceKey=loggers.map(logger=>logger.serial).sort().join(',');
  useEffect(()=>{
    if(!expanded)return;
    const controller=new AbortController();let active=true;
    setBusy(true);setError('');setResult(null);
    void api('/api/hobo?action=overview',{signal:controller.signal}).then(data=>{if(active)setResult(data);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'無法載入設備摘要。');}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;controller.abort();};
  },[api,expanded,deviceKey,refreshKey,reload]);
  return <div className="space-y-3">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={expanded} onChange={e=>setExpanded(e.target.checked)}/>顯示全部設備摘要</label>
    {expanded&&<section aria-label="全部 HOBO 設備摘要" className="rounded-lg border p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">全部設備的資料筆數與時間範圍（UTC）</p><Button type="button" variant="outline" disabled={busy} onClick={()=>setReload(value=>value+1)}>更新摘要</Button></div>
      <p className="text-xs text-slate-500">筆數以感測器量測紀錄計算。本機暫存與 S3 可能重疊，請勿直接相加。首次讀取舊歸檔的第一筆時間可能需要稍候。「定期同步」代表排程是否啟用；「目前同步工作」包含手動匯入與排程工作，狀態隨頁面約每 15 秒更新。按「查詢此設備」後，請至下方設定日期並按「搜尋資料」。</p>
      {busy&&<p role="status" className="text-sm">正在讀取設備摘要…</p>}{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
      {result&&<><p className="text-xs text-slate-500">摘要更新時間（UTC）：{result.generated_at}；共 {result.loggers.length} 台</p><div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50"><tr>{['設備','定期同步','目前同步工作','本機筆數','S3 筆數','第一筆時間（UTC）','最後一筆時間（UTC）','操作'].map(label=><th key={label} className="p-3 whitespace-nowrap">{label}</th>)}</tr></thead><tbody>{result.loggers.map(logger=><tr key={logger.serial} className={logger.serial===selectedSerial?'border-t bg-teal-50':'border-t'}><td className="p-3"><span className="block">{logger.name}</span><span className="text-xs text-slate-500">{logger.serial}</span></td><td className="p-3 whitespace-nowrap">{syncState(logger).enabled===undefined?'—':syncState(logger).enabled?`啟用（每 ${syncState(logger).interval_minutes||60} 分鐘）`:'停用'}</td><td className="p-3 whitespace-nowrap">{workLabel(logger)}</td><td className="p-3">{logger.observations}</td><td className="p-3">{logger.archived||0}</td><td className="p-3 whitespace-nowrap">{logger.first_error?<span className="text-rose-700">{logger.first_error}</span>:logger.first||'—'}</td><td className="p-3 whitespace-nowrap">{logger.latest||'—'}</td><td className="p-3"><Button type="button" variant="outline" onClick={()=>onSelect(logger.serial)}>查詢此設備</Button></td></tr>)}</tbody></table>{!result.loggers.length&&<p className="p-3 text-sm text-slate-500">尚未新增設備。</p>}</div></>}
    </section>}
  </div>;
}
