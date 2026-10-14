"use client";

import {useState} from "react";
import {ChevronsUpDown, Search} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";

type Option = {value: string; label: string; description?: string; deviceId?: string; disabled?: boolean};

export default function DeviceMultiSelect({options, value, onValueChange, disabled, isEnglish}: {
  options: Option[];
  value: string[];
  onValueChange: (values: string[]) => void;
  disabled?: boolean;
  isEnglish?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const enabled = options.filter(option => !option.disabled);
  const selected = new Set(value);
  const chosen = options.filter(option => selected.has(option.value));
  const filtered = options.filter(option => (option.label + " " + (option.description || "")).toLowerCase().includes(search.trim().toLowerCase()));
  const allSelected = enabled.length > 0 && chosen.length === enabled.length;
  const summary = allSelected && chosen.length > 1 ? (isEnglish ? "All authorized data" : "下載所有授權資料") : chosen.length === 1 ? chosen[0].label : chosen.length > 1
    ? (isEnglish ? `${new Set(chosen.map(o => o.deviceId || o.value)).size} devices / ${chosen.length} segments` : `已選 ${new Set(chosen.map(o => o.deviceId || o.value)).size} 台／${chosen.length} 個區段`)
    : (isEnglish ? "Search and select devices" : "搜尋並選擇設備");
  const toggle = (id: string) => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id); else next.add(id);
    onValueChange(options.filter(option => next.has(option.value)).map(option => option.value));
  };

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" disabled={disabled || !options.length}
        className="w-full min-w-0 max-w-full h-11 justify-between bg-white font-normal"
        aria-label={isEnglish ? "Select devices" : "選擇設備"} title={summary}>
        <span key={summary} className="min-w-0 flex-1 truncate text-left" translate="no">{summary}</span>
        <ChevronsUpDown size={15} className="shrink-0 opacity-50"/>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="p-0 w-[var(--radix-popover-trigger-width)] min-w-0 max-w-[calc(100vw-24px)]">
      <div className="p-3 border-b">
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-3 text-slate-400"/>
          <Input value={search} onChange={event => setSearch(event.target.value)} className="pl-8 min-w-0"
            aria-label={isEnglish ? "Search device or lab ID" : "搜尋設備編號或 lab_id"}
            placeholder={isEnglish ? "Device ID / lab_id" : "設備編號 / lab_id"}/>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-2 mt-3 text-xs">
          <button type="button" className="text-teal-700 underline" aria-pressed={allSelected} onClick={() => onValueChange(allSelected ? [] : enabled.map(option => option.value))}>
            {isEnglish ? "All authorized devices" : "下載所有授權資料"}
          </button>
          <button type="button" className="text-teal-700 underline" disabled={!filtered.length}
            onClick={() => onValueChange(enabled.filter(option => selected.has(option.value) || filtered.some(match => match.value === option.value)).map(option => option.value))}>
            {isEnglish ? "Select search results" : "勾選搜尋結果"}
          </button>
          <button type="button" className="text-slate-500 underline" onClick={() => onValueChange([])}>{isEnglish ? "Clear" : "清除"}</button>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto p-1" aria-label={isEnglish ? "Available devices" : "可選設備"}>
        {filtered.map(option => <label key={option.value} className="flex items-start gap-2 px-2 py-2 rounded hover:bg-slate-100 cursor-pointer">
          <input type="checkbox" className="mt-1 shrink-0 accent-teal-700" disabled={option.disabled} checked={selected.has(option.value)}
            onChange={() => toggle(option.value)} aria-label={option.label}/>
          <span className="min-w-0 text-sm break-words [overflow-wrap:anywhere]" translate="no"><span className="block">{option.label}</span>{option.description && <span className="block mt-0.5 text-xs text-slate-500">{option.description}</span>}</span>
        </label>)}
        {!filtered.length && <p className="p-3 text-sm text-slate-500">{isEnglish ? "No matching devices" : "沒有符合的設備"}</p>}
      </div>
      <div className="border-t p-3 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span aria-live="polite">{isEnglish ? `${chosen.length} / ${options.length} segments` : `已選 ${chosen.length}／共 ${options.length} 個區段`}</span>
        <Button type="button" size="sm" onClick={() => setOpen(false)}>{isEnglish ? "Done" : "完成"}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
