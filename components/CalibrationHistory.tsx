"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,Eye,Pencil,RefreshCw,Trash2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {inclusiveCalibrationEnd} from '@/lib/calibration-dates.mjs';
import {toast} from 'sonner';

type Log={id:number;source_id:string;source_name:string;source_url:string;source_description:string;source_archived:number;status:string;message:string;record_count:number;created_at:string;actor:string;version_id:number|null;has_snapshot:number;has_file:number;note:string;revision:number;updated_at:string|null;updated_by:string|null};
type Issue={rows:number[];device:string;channel:string;reason:string};
type Coefficient={id:number;aslung_id:string;channel:string;row_number:number;start:string;end:string|null;a1:number;b1:number;breakpoint:number|null;a2:number|null;b2:number|null;boundary_note:string};
type Listing={logs:Log[];total:number;hasMore:boolean};
type Detail={log:Log;issues:Issue[];records:Coefficient[];total:number;hasMore:boolean};
type Props={api:(path:string,options?:RequestInit)=>Promise<any>;formatTime:(s:string)=>string;isEnglish:boolean;source:string;refreshKey:number;onEditSource:(id:string)=>void};
const labels:Record<string,[string,string]>={UPDATED:['已更新','Updated'],UNCHANGED:['內容無變更','Unchanged'],FAILED:['同步失敗','Failed'],SKIPPED:['已略過','Skipped']};
export default function CalibrationHistory({api,formatTime,isEnglish:en,source,refreshKey,onEditSource}:Props){
  const [listing,setListing]=useState<Listing|null>(null),[offset,setOffset]=useState(0),[selected,setSelected]=useState<number[]>([]);
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [detailId,setDetailId]=useState<number|null>(null),[detail,setDetail]=useState<Detail|null>(null),[detailOffset,setDetailOffset]=useState(0),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
  const [editing,setEditing]=useState(false),[note,setNote]=useState(''),[deleting,setDeleting]=useState<number[]|null>(null);
  const generation=useRef(0),detailGeneration=useRef(0);
  const status=(value:string)=>labels[value]?.[en?1:0]||value;
  const load=useCallback(async()=>{
    const token=++generation.current;setLoading(true);setError('');
    try{const value=await api('/api/calibration/history?'+new URLSearchParams({source,offset:String(offset)}));if(token===generation.current){setListing(value);setSelected([]);}}
    catch(e){if(token===generation.current)setError((e as Error).message);}
    finally{if(token===generation.current)setLoading(false);}
  },[api,source,offset]);
  useEffect(()=>{setOffset(0);setSelected([]);},[source]);
  useEffect(()=>{void load();return()=>{generation.current++;};},[load,refreshKey]);
  const loadDetail=useCallback(async()=>{
    if(detailId===null)return;const token=++detailGeneration.current;setDetailLoading(true);setDetailError('');setDetail(null);
    try{const value:Detail=await api('/api/calibration/history?'+new URLSearchParams({id:String(detailId),offset:String(detailOffset)}));if(token===detailGeneration.current){setDetail(value);setNote(value.log.note);}}
    catch(e){if(token===detailGeneration.current)setDetailError((e as Error).message);}
    finally{if(token===detailGeneration.current)setDetailLoading(false);}
  },[api,detailId,detailOffset]);
  useEffect(()=>{void loadDetail();return()=>{detailGeneration.current++;};},[loadDetail]);
  function open(id:number,edit=false){setDetail(null);setDetailError('');setDetailOffset(0);setDetailId(id);setEditing(edit);}
  async function download(id:number){
    setBusy(true);try{
      const res=await fetch('/api/calibration/history?'+new URLSearchParams({id:String(id),download:'1'}),{cache:'no-store'});
      if(!res.ok){const result=await res.json();throw new Error(result.error||'Download failed');}
      const url=URL.createObjectURL(await res.blob()),a=document.createElement('a');a.href=url;a.download=`calibration-import-${id}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){toast.error((e as Error).message);}finally{setBusy(false);}
  }
  async function save(){
    if(!detail)return;setBusy(true);try{
      await api('/api/calibration/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'note',id:detail.log.id,note,revision:detail.log.revision})});
      toast.success(en?'Note saved':'備註已儲存');setEditing(false);await Promise.all([load(),loadDetail()]);
    }catch(e){toast.error((e as Error).message);}finally{setBusy(false);}
  }
  async function remove(){
    if(!deleting)return;setBusy(true);try{
      await api('/api/calibration/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',ids:deleting})});
      if(detailId!==null&&deleting.includes(detailId))setDetailId(null);
      setDeleting(null);toast.success(en?'Import logs deleted':'匯入日誌已刪除');
      if(offset&&listing&&listing.logs.every(l=>deleting.includes(l.id)))setOffset(Math.max(0,offset-50));else await load();
    }catch(e){toast.error((e as Error).message);}finally{setBusy(false);}
  }
  return <section id="calibration-import-history" className="panel scroll-mt-6 p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{en?'Import history':'匯入紀錄'} <span className="text-xs font-normal text-slate-400">({listing?.total||0})</span></h2><p className="mt-1 text-xs leading-6 text-slate-500">{en?'Open a log to view its report, coefficient version and downloads. Notes can be edited; original import results are preserved.':'點擊紀錄可查看完整報告、係數版本與下載項目。可編輯備註；原始匯入結果保留。'}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading||busy} onClick={()=>void load()}><RefreshCw size={14}/>{en?'Refresh':'重新整理'}</Button><Button size="sm" variant="outline" className="text-rose-700" disabled={busy||!selected.length} onClick={()=>setDeleting(selected)}><Trash2 size={14}/>{en?'Delete selected':'刪除所選'} {selected.length||''}</Button></div></div>
    {error&&<p role="alert" className="mb-3 text-sm text-rose-700">{error}</p>}
    <div className="max-h-96 overflow-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="p-3"><input type="checkbox" aria-label={en?'Select this page':'選取本頁'} checked={!!listing?.logs.length&&listing.logs.every(l=>selected.includes(l.id))} onChange={e=>setSelected(e.target.checked?listing?.logs.map(l=>l.id)||[]:[])}/></th>{[en?'Time':'匯入時間',en?'Source':'來源',en?'Status':'狀態',en?'Records':'筆數',en?'Version':'版本',en?'Actor':'執行者',en?'Actions':'操作'].map(h=><th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead><tbody>{listing?.logs.map(log=><tr key={log.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={()=>open(log.id)}><td className="p-3" onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label={`${en?'Select log':'選取紀錄'} ${log.id}`} checked={selected.includes(log.id)} onChange={e=>setSelected(e.target.checked?[...selected,log.id]:selected.filter(id=>id!==log.id))}/></td><td className="p-3 font-mono">{formatTime(log.created_at)}</td><td className="max-w-56 p-3"><span className="block truncate">{log.source_name}</span>{log.source_archived? <span className="text-slate-400">{en?'Source deleted':'來源已刪除'}</span>:null}{log.note&&<span className="mt-1 block truncate text-teal-700">{log.note}</span>}</td><td className="p-3"><span className={log.status==='FAILED'?'text-rose-700':'text-teal-700'}>{status(log.status)}</span></td><td className="p-3">{log.status==='FAILED'?'—':log.record_count}</td><td className="p-3">{log.version_id?`#${log.version_id}`:'—'}</td><td className="p-3">{log.actor}</td><td className="p-3" onClick={e=>e.stopPropagation()}><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>open(log.id)}><Eye size={13}/>{en?'Details':'詳細資料'}</Button><Button size="sm" variant="ghost" aria-label={en?'Edit note':'編輯備註'} disabled={busy} onClick={()=>open(log.id,true)}><Pencil size={13}/></Button><Button size="sm" variant="ghost" className="text-rose-700" aria-label={en?'Delete log':'刪除日誌'} disabled={busy} onClick={()=>setDeleting([log.id])}><Trash2 size={13}/></Button></div></td></tr>)}</tbody></table></div>
    {!listing?.logs.length&&<p className="py-6 text-center text-sm text-slate-400">{loading?(en?'Loading…':'載入中…'):(en?'No import logs':'尚無匯入紀錄')}</p>}
    <div className="mt-4 flex items-center justify-between text-xs text-slate-500"><span>{listing?.total?offset+1:0}–{offset+(listing?.logs.length||0)} / {listing?.total||0}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading||!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>{en?'Previous':'上一頁'}</Button><Button size="sm" variant="outline" disabled={loading||!listing?.hasMore} onClick={()=>setOffset(offset+50)}>{en?'Next':'下一頁'}</Button></div></div>
    <Dialog open={detailId!==null} onOpenChange={value=>{if(!value&&!busy)setDetailId(null);}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>{en?'Import details':'匯入詳細資料'} #{detailId}</DialogTitle><DialogDescription>{en?'The report and downloads describe this import attempt.':'報告及下載內容對應本次匯入。'}</DialogDescription></DialogHeader>
      {detailLoading&&<p>{en?'Loading…':'載入中…'}</p>}{detailError&&<p role="alert" className="text-rose-700">{detailError}</p>}
      {detail&&<div className="space-y-5 text-sm"><div className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2"><p>{en?'Source':'來源'}：{detail.log.source_name}</p><p>{en?'Status':'狀態'}：{status(detail.log.status)}</p><p>{en?'Time':'時間'}：{formatTime(detail.log.created_at)}</p><p>{en?'Actor':'執行者'}：{detail.log.actor}</p><p>{en?'Imported version':'匯入版本'}：{detail.log.version_id?`#${detail.log.version_id}`:'—'}</p><p>{en?'Records / issues':'筆數／問題數'}：{detail.log.status==='FAILED'?'—':detail.log.record_count} / {detail.issues.length}</p><a className="break-all text-teal-700 underline sm:col-span-2" href={detail.log.source_url} target="_blank" rel="noreferrer">{detail.log.source_url}</a><p className="whitespace-pre-wrap sm:col-span-2">{detail.log.source_description||'—'}</p></div>
        {!detail.log.has_snapshot&&<p className="rounded-lg bg-amber-50 p-3 text-xs leading-6 text-amber-900">{en?'This older log has no import snapshot. Its original file and coefficient version cannot be reconstructed; the report remains available. Source information reflects existing settings.':'此為舊紀錄，未保存當次匯入快照，無法回溯原始匯入檔或確定係數版本；仍可下載原有報告。來源資訊取自現存設定。'}</p>}
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={()=>void download(detail.log.id)}><Download size={14}/>{en?'Download import package (ZIP)':'下載匯入資料包（ZIP）'}</Button>{!detail.log.source_archived&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>{onEditSource(detail.log.source_id);setDetailId(null);}}><Pencil size={14}/>{en?'Edit source settings':'編輯來源設定'}</Button>}</div><p className="text-xs leading-6 text-slate-500">{en?'ZIP includes metadata and the full report, plus the original CSV, issue list and imported coefficients when available.':'ZIP 包含紀錄資訊與完整報告；有保存時另附原始 CSV、錯誤清單及匯入係數。'}</p>
        <div><h3 className="mb-2 font-semibold">{en?'Full report':'完整報告'}</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-3 font-sans text-xs leading-6">{detail.log.message}</pre></div>
        {!!detail.issues.length&&<div><h3 className="mb-2 font-semibold">{en?'All issues':'全部錯誤／衝突'} ({detail.issues.length})</h3><div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{[en?'Sheet rows':'原表列號','ASLUNG ID',en?'Channel':'通道',en?'Reason':'原因'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{detail.issues.map((i,n)=><tr key={n} className="border-t"><td className="p-2">{i.rows.join('、')}</td><td className="p-2">{i.device}</td><td className="p-2">{i.channel}</td><td className="p-2">{i.reason}</td></tr>)}</tbody></table></div></div>}
        {!!detail.log.version_id&&<div><h3 className="mb-2 font-semibold">{en?'Imported coefficients':'當次版本係數'} ({detail.total})</h3><div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead><tr>{[en?'Sheet row':'原表列號','ASLUNG ID',en?'Channel':'通道',en?'Period':'適用期間',en?'Segment 1':'第一段',en?'Breakpoint':'分段點',en?'Segment 2':'第二段'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{detail.records.map(r=><tr key={r.id} className="border-t"><td className="p-2">{r.row_number}</td><td className="p-2">{r.aslung_id}</td><td className="p-2">{r.channel}</td><td className="p-2">{formatTime(r.start)} → {r.end?formatTime(inclusiveCalibrationEnd(r.end)!):'∞'}{r.boundary_note&&<span className="block max-w-80 whitespace-normal text-amber-700">{r.boundary_note}</span>}</td><td className="p-2">{r.a1} × x + {r.b1}</td><td className="p-2">{r.a2===null?'—':r.breakpoint}</td><td className="p-2">{r.a2===null?'—':`${r.a2} × x + ${r.b2}`}</td></tr>)}</tbody></table></div><div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="outline" disabled={busy||!detailOffset} onClick={()=>setDetailOffset(Math.max(0,detailOffset-100))}>{en?'Previous':'上一頁'}</Button><Button size="sm" variant="outline" disabled={busy||!detail.hasMore} onClick={()=>setDetailOffset(detailOffset+100)}>{en?'Next':'下一頁'}</Button></div></div>}
        <div className="rounded-lg border p-4"><div className="mb-2 flex justify-between"><Label htmlFor="cal-history-note">{en?'Import note':'匯入備註'}</Label>{!editing&&<button className="text-xs text-teal-700 underline" onClick={()=>setEditing(true)}>{en?'Edit':'編輯'}</button>}</div>{editing?<><Textarea id="cal-history-note" value={note} maxLength={3000} rows={4} onChange={e=>setNote(e.target.value)} disabled={busy}/><div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={()=>{setNote(detail.log.note);setEditing(false);}}>{en?'Cancel':'取消'}</Button><Button size="sm" disabled={busy} onClick={()=>void save()}>{en?'Save note':'儲存備註'}</Button></div></>:<p className="whitespace-pre-wrap">{detail.log.note||'—'}</p>}{detail.log.updated_at&&<p className="mt-2 text-xs text-slate-400">{formatTime(detail.log.updated_at)} · {detail.log.updated_by}</p>}</div>
      </div>}
    </DialogContent></Dialog>
    <Dialog open={deleting!==null} onOpenChange={value=>{if(!value&&!busy)setDeleting(null);}}><DialogContent><DialogHeader><DialogTitle>{en?'Delete import logs?':'刪除匯入日誌？'}</DialogTitle><DialogDescription>{en?`Delete ${deleting?.length||0} selected logs and their download snapshots. Imported coefficients, current source versions and completed processing results remain available. This cannot be undone.`:`將刪除 ${deleting?.length||0} 筆日誌及其下載快照。已匯入係數、來源目前版本與已完成校正結果會保留。此操作無法復原。`}</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setDeleting(null)}>{en?'Cancel':'取消'}</Button><Button variant="destructive" disabled={busy} onClick={()=>void remove()}>{en?'Delete':'確認刪除'}</Button></div></DialogContent></Dialog>
  </section>;
}
