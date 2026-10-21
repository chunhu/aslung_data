"use client";
import ProcessingJobs from '@/components/ProcessingJobs';
import CalibrationHistory from '@/components/CalibrationHistory';
import {inclusiveCalibrationEnd} from '@/lib/calibration-dates.mjs';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Plus,RefreshCw,Pencil,CloudDownload,Trash2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {toast} from 'sonner';

type Source={id:string;name:string;url:string;description:string;enabled:number;current_version:number|null;last_status:string;last_error:string;last_success:string;next_check:string};
type RecordRow={id:number;version_id:number;aslung_id:string;channel:string;start:string;end:string|null;a1:number;b1:number;breakpoint:number|null;a2:number|null;b2:number|null;row_number:number;source_start?:string;source_end?:string;boundary_note?:string;source_name:string;source_enabled:number;quality:string};
type Data={sources:Source[];records:RecordRow[];devices:string[];total:number;hasMore:boolean;authentication:string;versions:{id:number;source_id:string;name:string;record_count:number;created_at:string}[];logs:{id:number;source_name:string;status:string;message:string;created_at:string}[]};
type Props={api:(path:string,options?:RequestInit)=>Promise<any>;formatTime:(s:string)=>string;isEnglish:boolean;isAdmin?:boolean};
const statusLabel:Record<string,string>={UPDATED:'已更新',UNCHANGED:'內容無變更',FAILED:'同步失敗',SKIPPED:'已略過'};
export default function CalibrationView({api,formatTime,isEnglish:en,isAdmin=false}:Props){
  const [data,setData]=useState<Data|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [device,setDevice]=useState(''),[source,setSource]=useState(''),[version,setVersion]=useState(''),[offset,setOffset]=useState(0);
  const [edit,setEdit]=useState<Source|null|undefined>(undefined),[name,setName]=useState(''),[url,setUrl]=useState(''),[description,setDescription]=useState('');
  const generation=useRef(0);
  const syncingRef=useRef(new Set<string>()),[syncing,setSyncing]=useState(new Set<string>());
  const [historyRefresh,setHistoryRefresh]=useState(0),[removeSource,setRemoveSource]=useState<Source|null>(null);
  const load=useCallback(async()=>{
    const id=++generation.current;setLoading(true);setError('');
    try{const result=await api('/api/calibration?'+new URLSearchParams({device,source,version,offset:String(offset)}));if(id===generation.current)setData(result);}
    catch(e){if(id===generation.current)setError((e as Error).message);}
    finally{if(id===generation.current)setLoading(false);}
  },[api,device,source,version,offset]);
  useEffect(()=>{void load();return()=>{generation.current++;};},[load]);
  async function post(p:object){setBusy(true);try{
    const result=await api('/api/calibration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
    if(result.status==='FAILED')toast.error(result.message.split('\n')[0]);else if(result.status==='SKIPPED')toast.info(result.message);else toast.success(result.message||(en?'Saved':'已儲存'));
    setHistoryRefresh(n=>n+1);await load();return result.status!=='FAILED';
  }catch(e){toast.error((e as Error).message);return false;}finally{setBusy(false);}}
  async function syncSource(s:Source){
    if(syncingRef.current.has(s.id))return;
    syncingRef.current.add(s.id);setSyncing(new Set(syncingRef.current));
    try{
      const result=await api('/api/calibration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sync',id:s.id})});
      const message=s.name+'：'+(result.message||'').split('\n')[0];
      if(result.status==='FAILED')toast.error(message);else if(result.status==='SKIPPED')toast.info(message);else toast.success(message);
      setHistoryRefresh(n=>n+1);await load();
    }catch(e){toast.error(s.name+'：'+(e as Error).message);}
    finally{syncingRef.current.delete(s.id);setSyncing(new Set(syncingRef.current));}
  }
  function open(s:Source|null){setEdit(s);setName(s?.name||'');setUrl(s?.url||'https://docs.google.com/spreadsheets/d/1_9JUQGciNLRafE-YyNO7kdqBwzq50YBzdu3szbtf4Ok/edit?gid=0');setDescription(s?.description||'');}
  return <div className="space-y-6">
    <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm leading-7 text-teal-900">{en?'Original measurements are preserved. Calibration uses measurement time and channel; Factor_* columns are not used. PM125 is retained for lookup only and is never used in calculations. UNMAPPED channels also remain lookup-only. Daily sync runs at 02:00 Asia/Taipei while the server is running.':'保留原始量測資料，依量測時間與通道套用校正，暫不使用 Factor_* 欄位；PM125 僅供查詢、不參與計算；UNMAPPED 為其他通道待對應。伺服器運作期間每日臺灣時間 02:00 自動檢查；停機後會在啟動時補查。'}<br/>{en?'Access: '+(data?.authentication==='service_account'?'read-only service account':'CSV readable by the server'):'讀取方式：'+(data?.authentication==='service_account'?'Google 唯讀服務帳號':'可由伺服器讀取的 Google CSV；私人表單需設定服務帳號')}</div>
    {error&&<p role="alert" className="whitespace-pre-wrap rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
    <section className="panel p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{en?'Calibration sources':'校正表單來源'} <span className="text-slate-400">{data?.sources.length||0}</span></h2><p className="mt-1 text-xs text-slate-500">{en?'One source per spreadsheet tab. Disabling a source preserves its history.':'每個來源指定一個分頁，可新增多個網址。停用後保留歷史，但不再套用該來源的參數。'}</p></div><div className="flex gap-2"><Button variant="outline" disabled={busy||loading} onClick={()=>void load()}><RefreshCw size={14}/>{en?'Refresh':'重新整理'}</Button><Button disabled={busy} onClick={()=>open(null)}><Plus size={14}/>{en?'Add source':'新增來源'}</Button></div></div>
    {!data?.sources.length?<p className="py-8 text-center text-sm text-slate-400">{loading?(en?'Loading…':'載入中…'):en?'Add your first calibration spreadsheet.':'新增第一個校正表單來源，即可開始同步與查詢。'}</p>:
      <div className="space-y-3">{data.sources.map(s=>{
        const sourceBusy=syncing.has(s.id),failed=!!s.enabled&&s.last_status==='FAILED';
        const label=sourceBusy?(en?'Syncing…':'同步中…'):!s.enabled?(en?'Disabled':'已停用'):en?({UPDATED:'Updated',UNCHANGED:'Unchanged',FAILED:'Sync failed',SKIPPED:'Skipped'}[s.last_status]||'Not synced'):(statusLabel[s.last_status]||'尚未同步');
        return <article key={s.id} aria-busy={sourceBusy} className="overflow-hidden rounded-xl border border-slate-200">
          <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-semibold text-slate-800">{s.name}</h3><span className={'rounded-full px-2.5 py-1 text-[11px] font-medium '+(!s.enabled?'bg-slate-100 text-slate-500':failed?'bg-rose-50 text-rose-700':'bg-teal-50 text-teal-700')}>{label}</span></div>
              <a href={s.url} title={s.url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-xs text-teal-700 hover:underline">{s.url}</a>
              {s.description&&<p className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-slate-500">{s.description}</p>}
            </div>
            <dl className="grid content-start gap-x-5 gap-y-3 text-xs sm:grid-cols-2">
              <div><dt className="text-slate-400">{en?'Current version':'目前版本'}</dt><dd className="mt-1 font-medium text-slate-700">{s.current_version?'#'+s.current_version:(en?'No imported version':'尚無匯入版本')}</dd></div>
              <div><dt className="text-slate-400">{en?'Daily synchronization':'每日自動同步'}</dt><dd className="mt-1 text-slate-700">{s.enabled?(en?'Enabled · 02:00 Taipei':'已啟用 · 臺灣時間 02:00'):(en?'Disabled':'已停用')}</dd></div>
              <div><dt className="text-slate-400">{en?'Last successful check':'最後成功檢查'}</dt><dd className="mt-1 text-slate-700">{s.last_success?formatTime(s.last_success):'—'}</dd></div>
              <div><dt className="text-slate-400">{en?'Next check':'下次檢查'}</dt><dd className="mt-1 text-slate-700">{s.enabled?formatTime(s.next_check):'—'}</dd></div>
            </dl>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
            <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" aria-label={s.name+' '+(en?'enabled':'啟用')} checked={!!s.enabled} disabled={busy||sourceBusy} onChange={e=>void post({action:'enabled',id:s.id,enabled:e.target.checked})}/>{en?'Enable source':'啟用來源'}</label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={()=>{setSource(s.id);setVersion('');setOffset(0);document.getElementById('calibration-import-history')?.scrollIntoView({behavior:'smooth',block:'start'});}}>{en?'View import history':'查看匯入紀錄'}</Button>
              <Button size="sm" variant="outline" disabled={busy||sourceBusy} onClick={()=>open(s)}><Pencil size={13}/>{en?'Edit':'編輯'}</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy||sourceBusy||!s.enabled} onClick={()=>void syncSource(s)}><CloudDownload size={13} className={sourceBusy?'animate-pulse':undefined}/>{sourceBusy?(en?'Syncing…':'同步中…'):(en?'Sync now':'立即同步')}</Button>
              <Button size="sm" variant="ghost" className="text-rose-700" disabled={busy||sourceBusy} onClick={()=>setRemoveSource(s)}><Trash2 size={13}/>{en?'Delete':'刪除'}</Button>
            </div>
          </div>
        </article>;
      })}</div>}
      <p className="mt-3 text-xs leading-6 text-slate-400">{en?'Sync now only checks the selected source tab. Full reports and downloads are available in the import history below.':'「立即同步」僅檢查所點來源的分頁。完整錯誤報告與下載統一放在下方「匯入紀錄」，點擊詳細資料即可查看。'}</p>
    </section>
    <CalibrationHistory api={api} formatTime={formatTime} isEnglish={en} source={source} refreshKey={historyRefresh} onEditSource={id=>{const s=data?.sources.find(item=>item.id===id);if(s)open(s);}}/>
    <section className="panel p-5"><h2 className="mb-4 font-semibold">{en?'Device calibration lookup':'設備校正參數查詢'}</h2><div className="mb-4 grid gap-3 md:grid-cols-3"><div><Label htmlFor="cal-device">ASLUNG ID</Label><Input id="cal-device" value={device} placeholder={en?'All devices':'所有設備'} list="cal-device-list" onChange={e=>{setDevice(e.target.value);setOffset(0);}}/><datalist id="cal-device-list">{data?.devices.map(id=><option key={id} value={id}/>)}</datalist></div><div><Label htmlFor="cal-source">{en?'Source':'來源'}</Label><select id="cal-source" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={source} onChange={e=>{setSource(e.target.value);setVersion('');setOffset(0);}}><option value="">{en?'All sources':'所有來源'}</option>{data?.sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div><Label htmlFor="cal-version">{en?'Version':'版本'}</Label><select id="cal-version" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={version} onChange={e=>{setVersion(e.target.value);setOffset(0);}}><option value="">{en?'Current source versions':'各來源目前版本'}</option>{data?.versions.map(v=><option key={v.id} value={v.id}>#{v.id} · {v.name} · {formatTime(v.created_at)}</option>)}</select></div></div><p className="mb-3 text-xs text-slate-500">{en?'Displayed end times are inclusive. A blank End_date applies until immediately before the next start time for the same device and channel, with no gap. Same-day handovers prioritize the new rule and retain the original dates. Exactly at the breakpoint uses segment 2.':'結束時間包含顯示時刻。未填 End_date 時，適用至同設備同通道下一筆開始時間的前一刻，新舊參數連續銜接。同日交接時新參數優先；保留原表日期與調整原因。原始值等於分段點時採第二段；第二段未填則全程採第一段。'} · {data?.total||0} {en?'records':'筆'}</p>
    <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="border-b text-slate-500"><tr>{['ASLUNG ID',en?'Channel':'通道',en?'Period (display timezone)':'適用期間（畫面時區）',en?'Segment 1 (a × x + b)':'第一段（a × x + b）',en?'Breakpoint':'分段點',en?'Segment 2':'第二段',en?'Source / version':'來源／版本'].map(h=><th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{data?.records.map(r=><tr key={r.id} className="border-b border-slate-100"><td className="px-3 py-3 font-mono font-medium">{r.aslung_id}</td><td className="px-3 py-3 font-mono">{r.channel}{r.channel==='PM125'&&<span className="mt-1 block font-sans text-[10px] text-amber-700">{en?'Lookup only':'僅供查詢'}</span>}</td><td className="px-3 py-3">{formatTime(r.start)} → {r.end?formatTime(inclusiveCalibrationEnd(r.end)!):'∞'}{r.source_start&&<span className="mt-1 block text-[10px] text-slate-400">{en?'Sheet dates':'原表日期'}：{r.source_start} → {r.source_end||'—'}</span>}{r.boundary_note&&<span className="mt-1 block max-w-72 whitespace-normal text-[10px] leading-5 text-amber-700">{r.boundary_note}</span>}</td><td className="px-3 py-3 font-mono">{r.a1} × x + {r.b1}</td><td className="px-3 py-3 font-mono">{r.a2===null?'—':r.breakpoint}</td><td className="px-3 py-3 font-mono">{r.a2===null?'—':`${r.a2} × x + ${r.b2}`}</td><td className="px-3 py-3">{r.source_name} · #{r.version_id}{!r.source_enabled&&'（停用）'}<span className="block text-slate-400">{en?'Sheet row':'原表列號'} {r.row_number}</span><details className="mt-1 text-slate-500"><summary>{en?'Quality indicators':'品質指標'}</summary><pre className="mt-1 max-w-64 overflow-auto">{JSON.stringify(JSON.parse(r.quality),null,2)}</pre></details></td></tr>)}</tbody></table></div>{!data?.records.length&&<p className="py-8 text-center text-sm text-slate-400">{loading?'載入中…':en?'No matching calibration records.':'尚無符合條件的校正參數。'}</p>}<div className="mt-4 flex items-center justify-between text-xs text-slate-500"><span>{offset+1}–{offset+(data?.records.length||0)} / {data?.total||0}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!offset||loading} onClick={()=>setOffset(Math.max(0,offset-200))}>{en?'Previous':'上一頁'}</Button><Button size="sm" variant="outline" disabled={!data?.hasMore||loading} onClick={()=>setOffset(offset+200)}>{en?'Next':'下一頁'}</Button></div></div></section>

    {isAdmin&&<ProcessingJobs api={api} formatTime={formatTime} isEnglish={en}/>}<Dialog open={edit!==undefined} onOpenChange={open=>{if(!open&&!busy)setEdit(undefined);}}><DialogContent><DialogHeader><DialogTitle>{edit?(en?'Edit source':'編輯校正來源'):(en?'Add calibration source':'新增校正來源')}</DialogTitle><DialogDescription>{en?'Specify one spreadsheet tab. New sources are included in daily synchronization.':'指定一個 Google 試算表分頁。新增後會加入每日同步；格式錯誤時不會取代舊參數。'}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={e=>{e.preventDefault();void post({action:'save',id:edit?.id,name,url,description}).then(ok=>{if(ok)setEdit(undefined);});}}><div><Label htmlFor="cal-name">{en?'Name':'來源名稱'}</Label><Input id="cal-name" required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></div><div><Label htmlFor="cal-url">Google {en?'spreadsheet URL (with gid)':'試算表網址（包含 gid）'}</Label><Input id="cal-url" required type="url" value={url} onChange={e=>setUrl(e.target.value)}/></div><div><Label htmlFor="cal-description">{en?'Description':'說明'}</Label><Textarea id="cal-description" maxLength={3000} rows={4} value={description} onChange={e=>setDescription(e.target.value)}/></div><p className="text-xs leading-6 text-slate-500">{en?'Required columns:':'必要欄位：'} aslung_id, PM, slope1, intercept1, Start_date。{en?'Optional:':'選填：'} End_date, break_point1, slope2, intercept2。</p><div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>setEdit(undefined)}>{en?'Cancel':'取消'}</Button><Button disabled={busy} type="submit">{en?'Save':'儲存'}</Button></div></form></DialogContent></Dialog>
    <Dialog open={removeSource!==null} onOpenChange={value=>{if(!value&&!busy)setRemoveSource(null);}}><DialogContent><DialogHeader><DialogTitle>{en?'Delete calibration source?':'刪除校正來源？'}</DialogTitle><DialogDescription>{en?'The source will be removed from the list and daily synchronization. Its coefficients will no longer be applied to new queries or jobs. Existing coefficient versions, import logs and completed results are retained.':'來源將從清單移除並停止每日同步，其係數將不再套用於新的查詢或校正工作。既有係數版本、匯入日誌與已完成的校正結果會保留。'}</DialogDescription></DialogHeader><p className="text-sm">{removeSource?.name}</p><div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setRemoveSource(null)}>{en?'Cancel':'取消'}</Button><Button variant="destructive" disabled={busy} onClick={()=>{if(removeSource)void post({action:'archive',id:removeSource.id}).then(ok=>{if(ok){if(source===removeSource.id){setSource('');setVersion('');setOffset(0);}setRemoveSource(null);}});}}>{en?'Delete source':'確認刪除來源'}</Button></div></DialogContent></Dialog>
  </div>;
}
