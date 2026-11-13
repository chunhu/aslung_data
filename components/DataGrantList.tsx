"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '@/components/ui/table';
type Props={grants:any[];members:any[];busy:boolean;canAdd:boolean;formatTime:(value:string)=>string;onAdd:()=>void;onEdit:(grant:any)=>void;onRevoke:(grants:any[])=>void};
export default function DataGrantList({grants,members,busy,canAdd,formatTime,onAdd,onEdit,onRevoke}:Props){
  const [selected,setSelected]=useState<Set<number>>(new Set()),[member,setMember]=useState(''),[kind,setKind]=useState(''),[search,setSearch]=useState('');
  const shown=grants.filter(row=>(!member||row.email===member)&&(!kind||(row.grant_type||'device')===kind)&&(!search.trim()||[row.lab_id,row.device_id,row.location_name,row.city_name,row.town_name,row.email,members.find(m=>m.email===row.email)?.name,members.find(m=>m.email===row.email)?.nickname].some(value=>String(value||'').toLowerCase().includes(search.trim().toLowerCase()))));
  const chosen=shown.filter(row=>selected.has(row.id));
  function filter(update:()=>void){setSelected(new Set());update();}
  const toggle=(id:number,checked:boolean)=>setSelected(previous=>{const next=new Set(previous);if(checked)next.add(id);else next.delete(id);return next;});
  return <section className="panel">
    <div className="list-heading flex-wrap"><div><h2>資料存取授權 <span className="count">{grants.length}</span></h2><p className="text-xs text-slate-500 mt-1">管理會員可存取的地點與設備；可先篩選會員，再全選並批量撤銷。</p></div><Button disabled={busy||!canAdd} onClick={onAdd}>新增授權</Button></div>
    <div className="p-5 space-y-3">
      <div className="flex flex-wrap gap-3 items-end"><label className="text-sm">會員<select aria-label="篩選授權會員" className="block h-10 max-w-full border rounded bg-white px-2" value={member} disabled={busy} onChange={event=>filter(()=>setMember(event.target.value))}><option value="">全部會員</option>{[...new Set(grants.map(row=>row.email))].map(email=><option key={email} value={email}>{members.find(m=>m.email===email)?.name||email}（{members.find(m=>m.email===email)?.nickname||email}）</option>)}</select></label>
        <label className="text-sm">類型<select aria-label="篩選授權類型" className="block h-10 border rounded bg-white px-2" value={kind} disabled={busy} onChange={event=>filter(()=>setKind(event.target.value))}><option value="">全部類型</option><option value="lab">地點授權</option><option value="device">設備授權</option></select></label>
        <label className="text-sm">搜尋<Input aria-label="搜尋授權" placeholder="設備、地點、會員" value={search} disabled={busy} onChange={event=>filter(()=>setSearch(event.target.value))}/></label>
      </div>
      <div className="flex flex-wrap gap-2 items-center text-sm"><span>符合條件 {shown.length} 筆 · 已選 {chosen.length} 筆</span><Button size="sm" variant="outline" disabled={busy||!chosen.length} onClick={()=>setSelected(new Set())}>清除選取</Button><Button size="sm" variant="destructive" disabled={busy||!chosen.length} onClick={()=>onRevoke(chosen)}>批量撤銷授權（{chosen.length}）</Button></div>
      <p className="text-xs text-slate-500">全選僅包含目前篩選結果，變更篩選條件會清除選取。撤銷地點授權會取消其設備的繼承存取；其他仍有效的授權會保留。</p>
    </div>
    <Table><TableHeader><TableRow><TableHead className="w-10"><input type="checkbox" aria-label={`全選篩選結果 ${shown.length} 筆授權`} disabled={busy||!shown.length} checked={!!shown.length&&chosen.length===shown.length} ref={node=>{if(node)node.indeterminate=chosen.length>0&&chosen.length<shown.length;}} onChange={event=>setSelected(event.target.checked?new Set(shown.map(row=>row.id)):new Set())}/></TableHead><TableHead>序號</TableHead><TableHead>授權類型與標的</TableHead><TableHead>會員</TableHead><TableHead>可存取資料期間（UTC+8）</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
      <TableBody>{!shown.length?<TableRow><TableCell colSpan={6} className="text-center py-8">沒有符合條件的授權紀錄</TableCell></TableRow>:shown.map((row,index)=><TableRow key={row.id}><TableCell><input type="checkbox" aria-label={`選取授權 ${row.id} ${row.lab_id||row.device_id} ${row.email}`} disabled={busy} checked={selected.has(row.id)} onChange={event=>toggle(row.id,event.target.checked)}/></TableCell><TableCell>{index+1}</TableCell><TableCell><span className="font-semibold">{row.grant_type==='lab'?'地點授權':'設備授權'} · {row.lab_id||row.device_id}</span><p className="cell-note">{[row.city_name,row.town_name,row.location_name].filter(Boolean).join(' ')}</p>{row.grant_type==='lab'&&<p className="text-xs text-blue-700">設備動態繼承地點授權</p>}</TableCell><TableCell>{members.find(m=>m.email===row.email)?.name||row.email}<p className="cell-note">{members.find(m=>m.email===row.email)?.nickname||row.email}</p></TableCell><TableCell>{row.grant_type==='lab'?<><span>動態繼承設備在站期間</span><p className="cell-note">依授權及設備追蹤紀錄判斷</p></>:<>{formatTime(row.start)}<br/>{row.end?formatTime(row.end):'無限制'}</>}</TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={()=>onEdit(row)}>編輯</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>onRevoke([row])}>撤銷授權</Button></div></TableCell></TableRow>)}</TableBody>
    </Table>
  </section>;
}
