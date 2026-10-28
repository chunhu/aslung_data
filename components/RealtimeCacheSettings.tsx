"use client";
import {useEffect,useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";

export default function RealtimeCacheSettings({seconds,busy,onSave}:{seconds:number;busy:boolean;onSave:(seconds:number)=>Promise<boolean>}){
  const [value,setValue]=useState(String(seconds));
  useEffect(()=>setValue(String(seconds)),[seconds]);
  return <section className="panel p-5 mb-4">
    <form className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();void onSave(Number(value));}}>
      <label className="space-y-2 text-sm font-medium" htmlFor="realtime-cache-seconds">
        <span className="block">共用量測快取（秒）</span>
        <Input id="realtime-cache-seconds" className="w-40" type="number" min={0} max={3600} step={1} required value={value} disabled={busy} onChange={event=>setValue(event.target.value)}/>
      </label>
      <Button type="submit" disabled={busy||value===String(seconds)}>儲存快取設定</Button>
    </form>
    <p className="mt-3 text-xs text-slate-500">全站共用，預設 120 秒，可設定 0–3600 秒；0 表示停用快取。儲存後於後續查詢生效。畫面更新頻率另外設定，手動更新會重新讀取量測；會員權限每次仍會檢查。</p>
  </section>;
}
