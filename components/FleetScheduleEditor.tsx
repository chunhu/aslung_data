"use client";
import {Input} from '@/components/ui/input';
export type FleetScheduleValue={scheduleType:string;scheduleTime:string;scheduleDays:string;intervalMins:string};
type Props={value:FleetScheduleValue;onChange:(value:FleetScheduleValue)=>void;disabled?:boolean};
export default function FleetScheduleEditor({value,onChange,disabled=false}:Props){
  const types=[['interval','⏱','固定間隔'],['daily','📅','每天固定時間'],['weekly','📆','每週固定時間']];
  const selected=new Set(value.scheduleDays.split(',').filter(Boolean));
  return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
    <div className="flex items-center justify-between text-xs"><strong className="text-teal-800">◷ 同步排程頻率設定</strong><span className="text-slate-400">時區：Asia/Taipei</span></div>
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-200/60 p-1">{types.map(([type,icon,label])=><button type="button" key={type} aria-pressed={value.scheduleType===type} className={'rounded-lg px-2 py-2 text-xs font-medium disabled:opacity-50 '+(value.scheduleType===type?'bg-white text-teal-800 shadow-sm':'text-slate-600')} onClick={()=>onChange({...value,scheduleType:type})}><span aria-hidden="true">{icon}</span> {label}</button>)}</div>
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      {value.scheduleType==='interval'?<label className="block">同步間隔（分鐘）<Input aria-label="同步週期（分鐘）" type="number" required min={1} max={10080} step={1} value={value.intervalMins} onChange={e=>onChange({...value,intervalMins:e.target.value})}/><span className="mt-1 block text-xs text-slate-400">每隔指定分鐘執行一次，範圍 1–10080 分鐘，預設 60。</span></label>:<>
        {value.scheduleType==='weekly'&&<div><p className="mb-2">每週執行同步日期</p><div className="flex flex-wrap gap-3">{[1,2,3,4,5,6,0].map(day=><label key={day} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={selected.has(String(day))} onChange={e=>{const next=new Set(selected);if(e.target.checked)next.add(String(day));else next.delete(String(day));onChange({...value,scheduleDays:[...next].sort().join(',')});}}/>週{'日一二三四五六'[day]}</label>)}</div></div>}
        <label className="block">{value.scheduleType==='weekly'?'每週':'每日'}執行同步時間（Asia/Taipei）<Input aria-label="執行同步時間（Asia/Taipei）" type="time" required value={value.scheduleTime} onChange={e=>onChange({...value,scheduleTime:e.target.value})}/></label>
        <p className="text-xs text-slate-400">{value.scheduleType==='weekly'?'於所選星期的指定時間執行；同一排程時段不重複同步。':'每天到達指定時間自動同步；當天同一時段不重複同步。'}</p>
      </>}
    </div>
    <p className="text-[11px] leading-5 text-slate-400">由伺服器每分鐘檢查，關閉頁面仍會執行；實際開始時間受佇列及來源回應影響。</p>
  </fieldset>;
}
