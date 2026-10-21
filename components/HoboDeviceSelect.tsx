"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
type Logger={serial:string;name:string};
type Props={loggers:Logger[];value:string;onChange:(serial:string)=>void;disabled?:boolean;label?:string};
export default function HoboDeviceSelect({loggers,value,onChange,disabled=false,label='選擇 HOBO 設備'}:Props){
  const [open,setOpen]=useState(false),[search,setSearch]=useState('');
  const selected=loggers.find(logger=>logger.serial===value);
  const options=loggers.filter(logger=>`${logger.serial} ${logger.name}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <Popover open={open} onOpenChange={value=>{setOpen(value);if(!value)setSearch('');}}>
    <PopoverTrigger asChild><Button type="button" variant="outline" disabled={disabled||!loggers.length} role="combobox" aria-expanded={open} aria-label={label} className="w-full justify-between min-w-0 h-10 font-normal bg-white"><span className="truncate">{selected?`${selected.name} (${selected.serial})`:label}</span><span aria-hidden="true">⌄</span></Button></PopoverTrigger>
    <PopoverContent align="start" className="p-2 w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-24px)]">
      <Input autoFocus value={search} aria-label="搜尋 HOBO 序號或名稱" placeholder="搜尋序號或名稱…" onChange={e=>setSearch(e.target.value)}/>
      <div role="listbox" aria-label={label} className="mt-2 max-h-56 overflow-y-auto">{options.map(logger=><button type="button" role="option" aria-selected={logger.serial===value} key={logger.serial} className="block w-full rounded p-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100" onClick={()=>{onChange(logger.serial);setOpen(false);setSearch('');}}><span className="block font-medium">{logger.name}</span><span className="text-xs text-slate-500">{logger.serial}</span></button>)}{!options.length&&<p className="p-3 text-sm text-slate-500">沒有符合的設備。</p>}</div>
      <p className="border-t pt-2 mt-2 text-xs text-slate-500">符合 {options.length}／共 {loggers.length} 台</p>
    </PopoverContent>
  </Popover>;
}
