"use client";
import {useId,useState} from 'react';
import {formatInTimeZone,fromZonedTime} from 'date-fns-tz';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {DEVICE_STATUSES,quickDeviceSnapshot} from '@/lib/fleet.mjs';
import {toast} from 'sonner';
import MaintainerName,{useMaintainerNames} from '@/components/MaintainerName';
type Props={row:any;field:'status'|'location'|'maintainer';labs:any[];maintainers:any[];timezone:string;api:(url:string,init?:RequestInit)=>Promise<any>;onClose:()=>void;onSaved:()=>Promise<void>};
const statuses:Record<string,string>=DEVICE_STATUSES;
const selectClass='h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';
export default function DeviceQuickEdit(p:Props){
  const displayMaintainer=useMaintainerNames();
  const [status,setStatus]=useState(p.row.status),[lab,setLab]=useState(p.field==='location'?'':p.row.lab||''),[maintainer,setMaintainer]=useState(p.row.maintainer||''),[start,setStart]=useState(()=>formatInTimeZone(new Date(),p.timezone,"yyyy-MM-dd'T'HH:mm:ss"));
  const [note,setNote]=useState(''),[repair,setRepair]=useState(false),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const listId=useId(),deploy=p.field==='location'||(p.field==='status'&&status==='DEPLOYED');
  const nextStatus=deploy?'DEPLOYED':status,labInfo=p.labs.find(l=>l.id===lab),current=p.row.current;
  const unchanged=p.field==='maintainer'?maintainer===(p.row.maintainer||''):deploy?lab===(p.row.lab||''):status===p.row.status;
  const invalid=unchanged||(deploy&&(!labInfo||!start))||(repair&&p.field==='status'&&status==='MAINTENANCE'&&(!title.trim()||!description.trim()));
  async function save(){
    setBusy(true);setError('');
    try{
      const payload={action:'quick',id:p.row.id,field:p.field,expected:quickDeviceSnapshot(p.row,p.row.history),status:nextStatus,lab_id:lab,maintainer,
        start_time:deploy?fromZonedTime(start,p.timezone).toISOString():undefined,note,create_maintenance:p.field==='status'&&status==='MAINTENANCE'&&repair,repair_title:title,repair_description:description};
      const result=await p.api('/api/fleet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      await p.onSaved();toast.success(result.maintenanceId?'設備已更新並建立維修單':'設備已更新');p.onClose();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)p.onClose();}}><DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{confirm?'確認更新設備':p.field==='status'?'快速更新設備狀態':p.field==='location'?'快速更新部署地點':'快速指派負責人'}</DialogTitle><DialogDescription>{p.row.id} · {confirm?'確認以下影響後再儲存。':'選擇新值後，先檢查變更再儲存。'}</DialogDescription></DialogHeader>
    {error&&<p role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {!confirm?<form className="space-y-4" onSubmit={e=>{e.preventDefault();if(!invalid){setError('');setConfirm(true);}}}>
      {p.field==='status'&&<label className="grid gap-1.5 text-sm">設備狀態<select aria-label="新的設備狀態" className={selectClass} value={status} onChange={e=>setStatus(e.target.value)}>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
      {deploy&&<><label className="grid gap-1.5 text-sm">新部署地點<Input aria-label="新部署地點" list={listId} value={lab} maxLength={160} required onChange={e=>setLab(e.target.value)} placeholder="輸入或選擇 Lab ID／地點"/><datalist id={listId}>{p.labs.map(l=><option key={l.id} value={l.id}>{[l.city_name,l.town_name,l.location_name].filter(Boolean).join(' ')}</option>)}</datalist><span className="text-xs text-slate-500">{labInfo?[labInfo.city_name,labInfo.town_name,labInfo.location_name].filter(Boolean).join(' '):'請從已建檔地點中選擇，可輸入編號或地點名稱搜尋。'}</span></label><label className="grid gap-1.5 text-sm">生效時間（{p.timezone}）<Input aria-label="部署生效時間" type="datetime-local" step="1" value={start} required onChange={e=>setStart(e.target.value)}/></label></>}
      {(deploy||p.field==='maintainer')&&<label className="grid gap-1.5 text-sm">負責人<select aria-label="新的負責人" className={selectClass} value={maintainer} onChange={e=>setMaintainer(e.target.value)}><option value="">未指派負責人</option>{p.maintainers.map(m=><option key={m.name} value={m.name} translate="no" className="notranslate">{displayMaintainer(m.name)}</option>)}</select></label>}
      {p.field==='status'&&status==='MAINTENANCE'&&<div className="space-y-3 rounded-md border border-slate-200 p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={repair} onChange={e=>setRepair(e.target.checked)}/>同時建立故障維修單</label>{repair&&<><label className="grid gap-1.5 text-sm">維修主旨<Input aria-label="維修主旨" value={title} maxLength={200} required onChange={e=>setTitle(e.target.value)}/></label><label className="grid gap-1.5 text-sm">問題描述<Textarea aria-label="維修問題描述" value={description} maxLength={6000} required onChange={e=>setDescription(e.target.value)}/></label></>}</div>}
      <label className="grid gap-1.5 text-sm">異動說明（選填）<Input aria-label="快速更新說明" value={note} maxLength={1000} onChange={e=>setNote(e.target.value)}/></label>
      <p className="rounded-md bg-amber-50 p-3 text-xs leading-6 text-amber-900">{p.field==='maintainer'?'僅修改目前部署的負責人，並保留異動紀錄。':deploy?'會結束舊部署、建立新部署，並將設備設為使用中。快速更新不接受未來生效時間。':current?'這項變更會結束目前部署，歷史紀錄及授權仍保留。':'不會新增部署紀錄。連線狀態仍依最新回報自動判定。'}</p>
      <DialogFooter><Button type="button" variant="outline" onClick={p.onClose}>取消</Button><Button type="submit" disabled={invalid}>檢查變更</Button></DialogFooter>
    </form>:<div className="space-y-4"><dl className="grid gap-3 rounded-md bg-slate-50 p-4 text-sm"><div><dt className="text-slate-500">設備狀態</dt><dd>{statuses[p.row.status]||p.row.status} → {statuses[p.field==='maintainer'?p.row.status:nextStatus]}</dd></div>{p.field!=='maintainer'&&<div><dt className="text-slate-500">部署地點</dt><dd>{p.row.lab||'未部署'} → {deploy?lab:'未部署'}</dd></div>}{(deploy||p.field==='maintainer')&&<div><dt className="text-slate-500">負責人</dt><dd>{p.row.maintainer?<MaintainerName name={p.row.maintainer}/>:'未指派'} → {maintainer?<MaintainerName name={maintainer}/>:'未指派'}</dd></div>}{deploy&&<div><dt className="text-slate-500">生效時間</dt><dd>{start.replace('T',' ')}（{p.timezone}）</dd></div>}{note&&<div><dt className="text-slate-500">說明</dt><dd className="break-words">{note}</dd></div>}</dl>
      {p.field!=='maintainer'&&<p className="text-xs leading-6 text-amber-900">{current?'目前部署將結束，並保留完整歷史。':'目前沒有進行中的部署。'}{deploy?'新地點將成為目前部署。':''}{p.field==='status'&&status==='MAINTENANCE'&&repair?'將同時建立維修單：'+title+'。':''}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setConfirm(false)}>返回修改</Button><Button disabled={busy} onClick={()=>void save()}>{busy?'儲存中…':'確認儲存'}</Button></DialogFooter></div>}
  </DialogContent></Dialog>;
}
