"use client";
import {useMemo,useState} from 'react';
import {countryOptions} from '@/lib/countries.mjs';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

export default function CountrySelect({defaultValue='',required=false,isEnglish=false}:{defaultValue?:string;required?:boolean;isEnglish?:boolean}) {
  const [value,setValue]=useState(defaultValue),[search,setSearch]=useState(''),[open,setOpen]=useState(false);
  const options=useMemo(()=>countryOptions(isEnglish?'en':'zh-Hant'),[isEnglish]);
  const selected=options.find(option=>option.code===value);
  const placeholder=isEnglish?'Select country / region':'選擇國家／地區';
  return <div className="min-w-0">
    <input type="hidden" name="country" value={value}/>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button type="button" variant="outline" aria-label={isEnglish?'Country / region':'國家／地區'}
        aria-required={required} className="w-full min-w-0 justify-between font-normal h-11">
        <span className="truncate">{selected ? `${selected.name} (${selected.code})` : placeholder}</span><span aria-hidden="true">⌄</span>
      </Button></PopoverTrigger>
      <PopoverContent align="start" className="p-2 w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-24px)]">
        <Input aria-label={isEnglish?'Search countries':'搜尋國家／地區'} placeholder={isEnglish?'Country name or code':'中英文國名或代碼'} value={search} onChange={e=>setSearch(e.target.value)}/>
        <div className="mt-2 max-h-56 overflow-auto" role="listbox" aria-label={placeholder}>
          {!required && <button type="button" role="option" aria-selected={!value} className="block w-full text-left p-2 text-sm" onClick={()=>{setValue('');setOpen(false);}}>{isEnglish?'Not specified':'尚未填寫'}</button>}
          {options.filter(option=>`${option.name} ${option.english} ${option.chinese} ${option.code}`.toLowerCase().includes(search.trim().toLowerCase())).map(option=>
            <button key={option.code} type="button" role="option" aria-selected={value===option.code}
              className="block w-full p-2 text-left text-sm rounded hover:bg-slate-100 break-words"
              onClick={()=>{setValue(option.code);setOpen(false);setSearch('');}}>{option.name} ({option.code})</button>)}
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}
