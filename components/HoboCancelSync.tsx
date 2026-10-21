"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
type Props={api:(url:string,options?:RequestInit)=>Promise<any>;job:{id:string;serial:string;start:string;end:string;status:string};onChange:()=>void};
export default function HoboCancelSync({api,job,onChange}:Props){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!['QUEUED','RUNNING','FAILED'].includes(job.status))return null;
  async function cancel(){
    setBusy(true);setError('');
    try{await api('/api/hobo',{method:'POST',body:JSON.stringify({action:'cancel',id:job.id})});setOpen(false);onChange();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <><Button className="ml-2 text-rose-700" variant="outline" size="sm" disabled={busy} onClick={()=>{setError('');setOpen(true);}}>取消工作</Button>
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent><DialogHeader><DialogTitle>取消 HOBO 同步工作？</DialogTitle><DialogDescription>停止此工作後續的下載及重試，並停用該設備的每小時自動同步，避免重新排入相同工作。已下載的本機及 S3 資料會保留；正在傳輸的請求會嘗試中止，尚未寫入的回傳資料將捨棄。</DialogDescription></DialogHeader>
      <p className="text-sm">設備：{job.serial}</p><p className="text-xs text-slate-500">{job.start} → {job.end}（UTC）</p>
      {error&&<p role="alert" className="text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>繼續同步</Button><Button variant="destructive" disabled={busy} onClick={()=>void cancel()}>{busy?'正在取消…':'確認取消工作'}</Button></div>
    </DialogContent></Dialog>
  </>;
}
