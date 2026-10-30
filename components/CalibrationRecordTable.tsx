"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {inclusiveCalibrationEnd} from '@/lib/calibration-dates.mjs';

export type CalibrationRecordRow={id:number;version_id:number;aslung_id:string;channel:string;start:string;end:string|null;a1:number;b1:number;breakpoint:number|null;a2:number|null;b2:number|null;row_number:number;source_start?:string;source_end?:string;boundary_note?:string;manual_edited_at?:string;manual_edited_by?:string;source_name:string;source_enabled:number;quality:string;is_current?:number};
type Props={records:CalibrationRecordRow[];api:(url:string,options?:RequestInit)=>Promise<any>;formatTime:(value:string)=>string;isEnglish:boolean;disabled:boolean;onChange:()=>void};
const fields=['aslung_id','channel','start','end','a1','b1','breakpoint','a2','b2'] as const;
export default function CalibrationRecordTable({records,api,formatTime,isEnglish:en,disabled,onChange}:Props){
  const [selected,setSelected]=useState<Set<number>>(new Set()),[editing,setEditing]=useState<CalibrationRecordRow|null>(null);
  const [draft,setDraft]=useState<Record<string,string>>({}),[deleting,setDeleting]=useState<CalibrationRecordRow[]|null>(null);
  const [confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const editable=records.filter(row=>row.is_current),chosen=editable.filter(row=>selected.has(row.id));
  const locked=disabled||busy,all=editable.length>0&&editable.every(row=>selected.has(row.id));
  useEffect(()=>{const ids=new Set(records.filter(r=>r.is_current).map(r=>r.id));setSelected(previous=>new Set([...previous].filter(id=>ids.has(id))));},[records]);
  function edit(row:CalibrationRecordRow){setError('');setNotice('');setEditing(row);setDraft(Object.fromEntries(fields.map(field=>[field,field==='start'||field==='end'?String(row[field]??'').replace(/Z$/,''):String(row[field]??'')])));}
  function remove(rows:CalibrationRecordRow[]){setError('');setNotice('');setConfirmation('');setDeleting(rows);}
  async function submit(operation:'edit'|'delete'){
    setBusy(true);setError('');
    try{
      const ids=operation==='edit'?[editing!.id]:deleting!.map(row=>row.id);
      const patch=operation==='edit'?{...draft,start:new Date(draft.start+'Z').toISOString(),end:draft.end?new Date(draft.end+'Z').toISOString():null}:undefined;
      const result=await api('/api/calibration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'records',operation,ids,patch,confirmation})});
      setNotice(result.message);setEditing(null);setDeleting(null);setSelected(new Set());onChange();
    }catch(e){setError(e instanceof Error?e.message:'Unable to update calibration records.');}finally{setBusy(false);}
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">{en?'Only current versions are editable. Changes create a new version and pause source synchronization; previous versions and completed results remain available.':'僅可修改來源目前版本。編輯／刪除會建立新版本並暫停該來源同步；舊版本與已完成成果保留。'}</p><Button type="button" variant="destructive" size="sm" disabled={locked||!chosen.length} onClick={()=>remove(chosen)}>{en?'Delete selected':'批量刪除'}（{chosen.length}）</Button></div>
    {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
    <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="border-b text-slate-500"><tr>
      <th className="p-3"><input type="checkbox" aria-label={en?'Select current records on this page':'全選本頁目前版本參數'} checked={all} disabled={locked||!editable.length} onChange={e=>setSelected(e.target.checked?new Set(editable.map(r=>r.id)):new Set())}/></th>
      {['ASLUNG ID',en?'Channel':'通道',en?'Period (display timezone)':'適用期間（畫面時區）',en?'Segment 1 (a × x + b)':'第一段（a × x + b）',en?'Breakpoint':'分段點',en?'Segment 2':'第二段',en?'Source / version':'來源／版本',en?'Actions':'操作'].map(label=><th key={label} className="p-3 font-medium">{label}</th>)}
    </tr></thead><tbody>{records.map(row=><tr key={row.id} className="border-b border-slate-100">
      <td className="p-3"><input type="checkbox" aria-label={`${en?'Select calibration record':'選取校正參數'} ${row.id}`} checked={selected.has(row.id)} disabled={locked||!row.is_current} onChange={e=>setSelected(previous=>{const next=new Set(previous);if(e.target.checked)next.add(row.id);else next.delete(row.id);return next;})}/></td>
      <td className="p-3 font-mono font-medium">{row.aslung_id}{(row.manual_edited_at||row.boundary_note?.includes('手動編輯參數'))&&<span className="mt-1 block rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{en?'Manually edited':'已手動編輯'}{row.manual_edited_at&&<span className="block">{formatTime(row.manual_edited_at)}</span>}{row.manual_edited_by&&<span className="block">{row.manual_edited_by}</span>}</span>}</td><td className="p-3 font-mono">{row.channel}{row.channel==='PM125'&&<span className="block text-amber-700">{en?'Lookup only':'僅供查詢'}</span>}</td>
      <td className="p-3">{formatTime(row.start)} → {row.end?formatTime(inclusiveCalibrationEnd(row.end)!):'∞'}{row.source_start&&<span className="mt-1 block text-[10px] text-slate-400">{en?'Sheet dates':'原表日期'}：{row.source_start} → {row.source_end||'—'}</span>}{row.boundary_note&&<span className="mt-1 block max-w-72 whitespace-normal text-[10px] text-amber-700">{row.boundary_note}</span>}</td>
      <td className="p-3 font-mono">{row.a1} × x + {row.b1}</td><td className="p-3 font-mono">{row.a2===null?'—':row.breakpoint}</td><td className="p-3 font-mono">{row.a2===null?'—':`${row.a2} × x + ${row.b2}`}</td>
      <td className="p-3">{row.source_name} · #{row.version_id}{!row.source_enabled&&(en?' (disabled)':'（停用）')}<span className="block text-slate-400">{en?'Sheet row':'原表列號'} {row.row_number}</span><details><summary>{en?'Quality indicators':'品質指標'}</summary><pre className="max-w-64 overflow-auto">{JSON.stringify(JSON.parse(row.quality),null,2)}</pre></details></td>
      <td className="p-3"><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={locked||!row.is_current} onClick={()=>edit(row)}>{en?'Edit':'編輯'}</Button><Button type="button" variant="outline" size="sm" className="text-rose-700" disabled={locked||!row.is_current} onClick={()=>remove([row])}>{en?'Delete':'刪除'}</Button></div>{!row.is_current&&<span className="text-slate-400">{en?'Historical version':'歷史版本僅供查詢'}</span>}</td>
    </tr>)}</tbody></table></div>
    <Dialog open={!!editing||!!deleting} onOpenChange={open=>{if(!open&&!busy){setEditing(null);setDeleting(null);setError('');}}}><DialogContent className="max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>{editing?(en?'Edit calibration parameters':'編輯校正參數'):(en?'Delete calibration parameters?':'刪除校正參數？')}</DialogTitle><DialogDescription>{en?'Create new source versions and pause automatic synchronization. Existing results and historical versions are retained.':'會建立來源新版本並暫停自動同步；保留既有成果與歷史版本。'}</DialogDescription></DialogHeader>
      {editing?<form id="calibration-record-editor" className="grid grid-cols-2 gap-3" onSubmit={e=>{e.preventDefault();void submit('edit');}}>{fields.map((field,index)=><label key={field} className="text-sm">{(en?['ASLUNG ID','Channel','Start (UTC)','End (UTC, exclusive)','Slope 1','Intercept 1','Breakpoint','Slope 2','Intercept 2']:['ASLUNG ID','通道','開始時間（UTC）','結束時間（UTC，不含此時刻）','第一段斜率','第一段截距','分段點','第二段斜率','第二段截距'])[index]}
        {field==='channel'?<select aria-label={en?'Calibration channel':'校正通道'} className="block h-10 w-full rounded border px-2" value={draft[field]} onChange={e=>setDraft({...draft,[field]:e.target.value})}>{[...new Set(['PM1_G3','PM2.5_G3','PM10_G3','PM1_GSA','PM2.5_GSA','PM10_GSA','PM125',editing.channel])].map(channel=><option key={channel}>{channel}</option>)}</select>:<Input aria-label={field} type={field==='start'||field==='end'?'datetime-local':field==='aslung_id'?'text':'number'} step="any" required={['aslung_id','start','a1','b1'].includes(field)} value={draft[field]||''} onChange={e=>setDraft({...draft,[field]:e.target.value})}/>}
      </label>)}</form>:<><p>{en?'Selected records':'本次刪除參數'}：{deleting?.length}</p><ul className="max-h-40 overflow-auto text-xs">{deleting?.map(row=><li key={row.id}>{row.aslung_id} · {row.channel} · #{row.version_id} · {formatTime(row.start)}</li>)}</ul><label className="text-sm">{en?'Type DELETE to confirm':'輸入 DELETE 確認刪除'}<Input value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></label></>}
      {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>{setEditing(null);setDeleting(null);setError('');}}>{en?'Cancel':'取消'}</Button>{editing?<Button type="submit" form="calibration-record-editor" disabled={busy}>{en?'Save new version':'儲存為新版本'}</Button>:<Button type="button" variant="destructive" disabled={busy||confirmation!=='DELETE'} onClick={()=>void submit('delete')}>{en?'Confirm deletion':'確認刪除'}</Button>}</div>
    </DialogContent></Dialog>
  </div>;
}
