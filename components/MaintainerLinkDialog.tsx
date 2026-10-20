"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {toast} from 'sonner';
type Props={member:{email:string;name:string};api:(url:string,options?:RequestInit)=>Promise<any>;onClose:()=>void;onSaved:()=>Promise<void>;isEnglish:boolean};
export default function MaintainerLinkDialog({member,api,onClose,onSaved,isEnglish:en}:Props){
  const [data,setData]=useState<any>(null),[ids,setIds]=useState<Set<string>>(new Set()),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let live=true;void api('/api/maintainer-links?'+new URLSearchParams({email:member.email})).then(result=>{if(live){setData(result);setIds(new Set(result.linked_ids));}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[member.email,api]);
  const shown=data?.maintainers.filter((m:any)=>(m.name+' '+m.english_name+' '+m.email).toLowerCase().includes(search.toLowerCase()))||[];
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[88vh] overflow-auto sm:max-w-xl"><DialogHeader><DialogTitle>{en?'Link maintainer identities':'維護身分關聯'}</DialogTitle><DialogDescription>{member.name} · {member.email}</DialogDescription></DialogHeader>
    <p className="rounded-lg bg-teal-50 p-3 text-xs leading-6 text-teal-900">{en?'Selected identities allow this member to monitor their currently assigned devices and receive alerts according to their email preference. Measurement download grants and account roles are unchanged. Matching email addresses are suggestions only.':'勾選此會員代表的維護人員身分，即可查看目前負責設備的斷線狀況，並依會員收信設定接收告警。會員角色與量測資料下載授權維持原設定。Email 相同僅供建議，不會自動勾選。'}</p>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    <Input aria-label={en?'Search maintainers':'搜尋維護人員'} placeholder={en?'Search name or email':'搜尋姓名、英文稱呼或 Email'} value={search} onChange={e=>setSearch(e.target.value)}/>
    <p className="text-xs text-slate-500">{en?'Selected identities':'已選維護身分'}：{ids.size}</p>
    <div className="max-h-72 space-y-1 overflow-auto rounded-lg border p-2">{shown.map((m:any)=><label key={m.maintainer_id} className="flex items-start gap-3 rounded p-2 text-sm hover:bg-slate-50"><input type="checkbox" className="mt-1" checked={ids.has(m.maintainer_id)} disabled={busy} onChange={e=>setIds(previous=>{const next=new Set(previous);if(e.target.checked)next.add(m.maintainer_id);else next.delete(m.maintainer_id);return next;})}/><span><strong translate="no">{en?(m.english_name||m.name):m.name}</strong><span className="block text-xs text-slate-500">{m.email}</span>{data.suggested_ids.includes(m.maintainer_id)&&<span className="text-xs text-amber-700">{en?'Matching email — confirm this identity':'Email 相同，請確認是否為本人身分'}</span>}</span></label>)}{data&&!shown.length&&<p className="p-3 text-sm text-slate-400">{en?'No matching maintainers.':'沒有符合的維護人員。'}</p>}</div>
    <p className="text-xs leading-6 text-slate-500">{en?'Clear all selections to remove explicit monitoring access. Once an identity uses account links, removing its last link also stops its account-routed alert emails. Changes are audited.':'取消全部勾選並儲存可解除明確關聯。維護身分採用會員關聯收信後，解除最後一位會員也會停止該身分的會員告警收信。所有異動會留下紀錄。'}</p>
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>{en?'Cancel':'取消'}</Button><Button disabled={busy||!data} onClick={async()=>{setBusy(true);setError('');try{await api('/api/maintainer-links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:member.email,maintainer_ids:[...ids],revision:data.revision})});await onSaved();toast.success(en?'Maintainer links saved':'維護身分關聯已儲存');onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{en?'Save links':'儲存關聯'}</Button></div>
    {!!data?.events.length&&<details className="text-xs text-slate-500"><summary>{en?'Recent changes':'近期關聯異動'}</summary>{data.events.map((event:any)=><p key={event.id} className="mt-2">{event.created_at} · {event.actor} · {JSON.parse(event.before_ids).length} → {JSON.parse(event.after_ids).length}</p>)}</details>}
  </DialogContent></Dialog>;
}
