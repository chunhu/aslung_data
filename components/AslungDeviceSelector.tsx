"use client";
import {useState} from 'react';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
type Props={devices:string[];selected:string[];onChange:(ids:string[])=>void;disabled?:boolean;isEnglish:boolean;label:string};
export default function AslungDeviceSelector({devices,selected,onChange,disabled=false,isEnglish:en,label}:Props){
 const [search,setSearch]=useState('');
 const choices=[...new Set([...devices,...selected])].sort().filter(id=>id.toLowerCase().includes(search.trim().toLowerCase()));
 const all=choices.length>0&&choices.every(id=>selected.includes(id));
 return <fieldset disabled={disabled} className="space-y-2 rounded border bg-white p-3"><legend className="px-1 text-sm font-medium">{label}</legend><Input aria-label={en?'Search ASLUNG IDs':'搜尋 ASLUNG ID'} value={search} onChange={e=>setSearch(e.target.value)} placeholder={en?'Search device IDs':'搜尋設備編號'}/><div className="flex flex-wrap items-center gap-3 text-sm"><label className="flex gap-2"><input type="checkbox" checked={all} disabled={!choices.length||disabled} onChange={e=>onChange(e.target.checked?[...new Set([...selected,...choices])]:selected.filter(id=>!choices.includes(id)))}/>{en?'Select all search results':'全選搜尋結果'} ({choices.length})</label><Button type="button" size="sm" variant="outline" disabled={disabled||!selected.length} onClick={()=>onChange([])}>{en?'Clear selection':'清空選取'}</Button><span>{en?'Selected':'已選'} {selected.length}</span></div><div className="max-h-40 overflow-auto grid grid-cols-2 gap-2 text-sm">{choices.map(id=><label key={id} className="flex gap-2"><input type="checkbox" checked={selected.includes(id)} onChange={e=>onChange(e.target.checked?[...selected,id]:selected.filter(v=>v!==id))}/>{id}</label>)}</div>{!choices.length&&<p className="text-sm text-slate-500">{en?'No matching devices':'沒有符合的設備'}</p>}</fieldset>;
}
