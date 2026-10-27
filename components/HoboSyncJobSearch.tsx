"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import HoboSyncJobs from '@/components/HoboSyncJobs';

type Props=Parameters<typeof HoboSyncJobs>[0];
type Query={q:string;status:string;source:string;offset:number};
type Page={jobs:any[];total:number;matched:number;offset:number;limit:number};
const empty:Query={q:'',status:'',source:'',offset:0};
export default function HoboSyncJobSearch(props:Props){
  const {api,jobs,totalJobs,onChange}=props;
  const [q,setQ]=useState(''),[status,setStatus]=useState(''),[source,setSource]=useState('');
  const [query,setQuery]=useState<Query>(empty),[result,setResult]=useState<{key:string;data:Page}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const key=JSON.stringify(query);
  useEffect(()=>{
    const controller=new AbortController();let active=true;setBusy(true);setError('');
    const params=new URLSearchParams({action:'jobs',q:query.q,status:query.status,source:query.source,offset:String(query.offset)});
    void api('/api/hobo?'+params,{signal:controller.signal}).then(data=>{if(active)setResult({key,data});}).catch(e=>{if(active)setError(e instanceof Error?e.message:'無法搜尋同步工作。');}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;controller.abort();};
  },[api,key,jobs,reload]);
  const page=result?.key===key?result.data:!query.q&&!query.status&&!query.source&&!query.offset?{jobs,total:totalJobs??0,matched:totalJobs??0,offset:0,limit:30}:null;
  function clear(){setQ('');setStatus('');setSource('');setQuery({...empty});setReload(value=>value+1);}
  return <div className="space-y-3"><section className="panel p-4 space-y-3" aria-label="搜尋同步工作">
    <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();setQuery({q:q.trim(),status,source,offset:0});setReload(value=>value+1);}}>
      <label className="text-sm flex-1 min-w-48">搜尋同步工作<Input aria-label="同步工作關鍵字" placeholder="設備序號、名稱或錯誤訊息" maxLength={160} value={q} onChange={e=>setQ(e.target.value)}/></label>
      <label className="text-sm">工作狀態<select aria-label="同步工作狀態" className="block h-10 rounded border bg-white px-2" value={status} onChange={e=>setStatus(e.target.value)}>{[['','全部狀態'],['QUEUED','排隊中'],['RUNNING','同步中'],['DONE','已完成'],['FAILED','失敗'],['CANCELLED','已取消']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">工作來源<select aria-label="同步工作來源" className="block h-10 rounded border bg-white px-2" value={source} onChange={e=>setSource(e.target.value)}>{[['','全部來源'],['schedule','定期排程'],['manual','手動匯入']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <Button type="submit">搜尋工作</Button><Button type="button" variant="outline" onClick={clear}>清除搜尋</Button>
    </form>
    <p className="text-xs text-slate-500">搜尋涵蓋全部工作紀錄，每頁 30 筆；全選與批量操作只適用目前頁面。背景更新會保留搜尋條件。</p>
    {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}{busy&&<p role="status" className="text-sm">正在更新同步工作…</p>}
    {page&&<div className="flex flex-wrap justify-between items-center gap-2 text-sm"><span>符合 {page.matched.toLocaleString()} 筆；目前第 {page.matched?page.offset+1:0}～{page.offset+page.jobs.length} 筆</span><div className="flex gap-2"><Button type="button" variant="outline" disabled={busy||page.offset===0} onClick={()=>setQuery({...query,offset:Math.max(0,page.offset-30)})}>上一頁</Button><Button type="button" variant="outline" disabled={busy||page.offset+page.jobs.length>=page.matched} onClick={()=>setQuery({...query,offset:page.offset+30})}>下一頁</Button></div></div>}
  </section>
    {page&&<HoboSyncJobs {...props} key={key} jobs={page.jobs} totalJobs={page.total} onChange={()=>{setReload(value=>value+1);onChange();}}/>}
  </div>;
}
