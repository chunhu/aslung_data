"use client";
import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';

type Props={id:string;api:(path:string,options?:RequestInit)=>Promise<any>;isEnglish:boolean;formatTime:(s:string)=>string;onClose:()=>void};
const labels:Record<string,string>={QUEUED:'排隊中',RUNNING:'處理中',COMPLETED:'已完成',FAILED:'失敗',DELETING:'清除中'};
export function storageLabel(status:string|null,en:boolean){
  const names:Record<string,string>={STORED:en?'S3 verified':'S3 已驗證',RETRY:en?'Local retained · S3 retry scheduled':'本機保留 · S3 等待重試',UPLOADING:en?'Uploading to S3':'S3 上傳中',PENDING:en?'Local retained · pending S3 upload':'本機保留 · 等待上傳 S3'};
  return names[status||'']||(en?'Local file':'本機檔案');
}
export default function ProcessingJobDetails({id,api,isEnglish:en,formatTime,onClose}:Props){
  const [job,setJob]=useState<any>(null),[error,setError]=useState('');
  const [preview,setPreview]=useState<any>(null),[previewError,setPreviewError]=useState(''),[loading,setLoading]=useState(false);
  const [offset,setOffset]=useState(0),[sensor,setSensor]=useState('G3');
  useEffect(()=>{
    const controller=new AbortController();
    void api('/api/processing?'+new URLSearchParams({id,detail:'1'}),{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setJob(result.job);})
      .catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);});
    return()=>controller.abort();
  },[id,api]);
  const show=useCallback(async(page=0)=>{
    setLoading(true);setPreviewError('');
    try{const result=await api('/api/processing?'+new URLSearchParams({id,offset:String(page)}),{signal:AbortSignal.timeout(120000)});setPreview(result);setOffset(page);}
    catch(e){setPreviewError((e as Error).name==='TimeoutError'?(en?'Preview timed out. Please retry.':'預覽讀取逾時，請重試。'):(e as Error).message);}
    finally{setLoading(false);}
  },[id,api,en]);
  const columns=['timestamp',...['PM1','PM2.5','PM10'].flatMap(pm=>[pm+'_'+sensor,pm+'_'+sensor+'_clean',pm+'_'+sensor+'_calibrated',pm+'_'+sensor+'_final']),'temperature_clean','rh_clean','co2_clean','_background_status','_quality'];
  const time=(value:string)=>value?formatTime(value):'—';
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
    <DialogHeader><DialogTitle>{en?'Processing job details':'校正工作詳細資料'}{job?' · '+job.device:''}</DialogTitle><DialogDescription>{en?'Inspect processing status and quality here. Use Data Query for date-range queries and bulk downloads.':'此處檢查工作狀態與資料品質；期間查詢及批量下載請至「資料查詢」。'}</DialogDescription></DialogHeader>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    {!job&&!error&&<p role="status">{en?'Loading details…':'正在載入詳細資料…'}</p>}
    {job&&<>
      <dl className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
        {[
          [en?'Device':'設備',job.device],[en?'Status':'工作狀態',en?job.status:labels[job.status]],
          [en?'Period (end exclusive)':'工作期間（不含結束時間）',time(job.start)+' → '+time(job.end)],
          [en?'Rows':'筆數',job.rows_done],[en?'Rules / raw fields':'規則／原始欄位版本',job.recipe.version+' / '+(job.recipe.rawSchema||'legacy')],
          ['up_limit',job.recipe.upLimit],[en?'Created':'建立時間',time(job.created_at)],[en?'Completed':'完成時間',time(job.finished_at)],
          [en?'Created by':'建立者',job.actor],[en?'Processing attempts':'執行次數',job.attempts],
          [en?'Storage':'成果儲存',job.status==='COMPLETED'?storageLabel(job.upload_status,en):'—'],
          [en?'Context period':'背景樣本期間',time(job.context_start)+' → '+time(job.context_end)],
          [en?'Job ID':'工作 ID',job.id],
        ].map(([label,value])=><div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-all">{value??'—'}</dd></div>)}
      </dl>
      {job.error&&<p role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{job.error}</p>}
      {job.upload_error&&<p role="alert" className="whitespace-pre-wrap break-words rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{job.upload_error}</p>}
      {job.status==='COMPLETED'&&<>
        <section className="space-y-2"><h3 className="font-semibold">{en?'Quality summary':'品質摘要'}</h3><p className="text-xs text-slate-500">{en?'Counts are per-field flags; they are not deleted row counts.':'旗標依欄位累計，同筆可能出現多個原因，不代表刪除筆數。'}</p>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">{Object.entries(job.summary.flags||{}).map(([flag,count])=><div className="rounded border p-2" key={flag}><dt className="break-all text-xs text-slate-500">{flag}</dt><dd>{String(count)}</dd></div>)}</dl>
          {!Object.keys(job.summary.flags||{}).length&&<p className="text-sm">{en?'No quality flags.':'沒有品質旗標。'}</p>}
          <p className="text-sm">{en?'Rows with insufficient context':'背景樣本不足筆數'}：{job.summary.incompleteContext??0}</p>
        </section>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3"><Button variant="outline" disabled={loading} onClick={()=>void show(0)}>{loading?(en?'Loading…':'讀取中…'):(en?'Load sample preview':'載入結果預覽')}</Button><a className="rounded border px-3 py-2 text-sm" href={'/api/processing?'+new URLSearchParams({id,download:'1'})}>{en?'Download this job (CSV ZIP)':'下載此工作（CSV ZIP）'}</a><span className="text-xs text-slate-500">{en?'Up to 200 rows per preview page.':'預覽每頁最多 200 筆。'}</span></div>
        {previewError&&<p role="alert" className="text-sm text-rose-700">{previewError}</p>}
        {preview&&<section className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{en?'Result preview':'結果預覽'}</h3><select aria-label={en?'Sensor':'感測器'} className="rounded border p-2 text-xs" value={sensor} onChange={e=>setSensor(e.target.value)}><option>G3</option><option>GSA</option></select><Button size="sm" variant="outline" disabled={loading||!offset} onClick={()=>void show(Math.max(0,offset-200))}>{en?'Previous':'上一頁'}</Button><Button size="sm" variant="outline" disabled={loading||!preview.hasMore} onClick={()=>void show(offset+200)}>{en?'Next':'下一頁'}</Button><span className="text-xs">{offset+1}–{offset+preview.data.length}</span></div><div className="max-h-80 overflow-auto"><table className="whitespace-nowrap text-left text-xs"><thead><tr>{columns.map(k=><th key={k} className="p-2">{k}</th>)}</tr></thead><tbody>{preview.data.map((row:any,i:number)=><tr key={i} className="border-t">{columns.map(k=><td key={k} className="p-2">{row[k]==null?'—':typeof row[k]==='object'?JSON.stringify(row[k]):String(row[k])}</td>)}</tr>)}</tbody></table></div>{!preview.data.length&&<p>{en?'No measurements in this job.':'此工作沒有量測資料。'}</p>}</section>}
      </>}
    </>}
  </DialogContent></Dialog>;
}
