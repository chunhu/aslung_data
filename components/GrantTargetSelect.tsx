"use client";

import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";

export default function GrantTargetSelect({options,value,onChange,kind,disabled}: {
  options: {value:string;label:string}[]; value:string[];
  onChange:(value:string[])=>void; kind:"lab"|"device"; disabled?:boolean;
}) {
  const [search,setSearch]=useState("");
  const selected=new Set(value);
  const filtered=options.filter(o=>o.label.toLowerCase().includes(search.trim().toLowerCase()));
  const change=(ids:string[])=>onChange(options.filter(o=>ids.includes(o.value)).map(o=>o.value));
  return <fieldset disabled={disabled} className="rounded-md border p-3 space-y-2">
    <legend className="px-1 text-sm">{kind==="lab"?"選擇地點":"選擇設備"}（可多選）</legend>
    <Input aria-label="搜尋授權標的" placeholder="輸入編號或名稱搜尋" value={search} onChange={e=>setSearch(e.target.value)}/>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={disabled||!options.length} onClick={()=>change(options.map(o=>o.value))}>全選（{options.length}）</Button>
      {search.trim()&&<Button type="button" size="sm" variant="outline" disabled={disabled||!filtered.length} onClick={()=>change([...value,...filtered.map(o=>o.value)])}>選取搜尋結果（{filtered.length}）</Button>}
      <Button type="button" size="sm" variant="outline" disabled={disabled||!value.length} onClick={()=>onChange([])}>清除選取</Button>
      <span role="status" className="text-xs text-slate-500">已選 {options.filter(o=>selected.has(o.value)).length} / {options.length}</span>
    </div>
    <div className="max-h-48 overflow-y-auto space-y-1">
      {filtered.map(o=><label key={o.value} className="flex items-start gap-2 p-1 text-sm cursor-pointer"><input type="checkbox" className="mt-1" checked={selected.has(o.value)} onChange={e=>change(e.target.checked?[...value,o.value]:value.filter(id=>id!==o.value))}/><span>{o.label}</span></label>)}
      {!filtered.length&&<p className="text-sm text-slate-500">沒有符合的項目。</p>}
    </div>
    <p className="text-xs text-slate-500">{kind==="lab"?"所選地點目前及未來進駐的設備依既有在站期間規則授權。":"全選僅涵蓋目前清單內的設備，未來新增設備需另行授權。"}所選項目使用相同會員與日期設定。</p>
  </fieldset>;
}
