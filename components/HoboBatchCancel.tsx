"use client";
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';

type Result={matched:number;disabled:number;cancelled:number;missing:string[]};
type Props={api:(url:string,options?:RequestInit)=>Promise<any>;serialsText:string;disabled?:boolean;onSuccess:(result:Result)=>void};
export default function HoboBatchCancel({api,serialsText,disabled=false,onSuccess}:Props){
  const [pending,setPending]=useState<string[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  function preview(){
    setError('');const serials=[...new Set(serialsText.trim().split(/[\s,，;；]+/).filter(Boolean))];
    if(!serials.length||serials.length>100||serials.some(serial=>!/^\d{1,30}$/.test(serial))){setError('請填寫 1 至 100 台有效設備序號。');return;}
    setPending(serials);
  }
  async function cancel(){
    if(!pending)return;setBusy(true);setError('');
    try{const result=await api('/api/hobo',{method:'POST',body:JSON.stringify({action:'cancelBatch',serials:pending,confirmation:'CANCEL'})});setPending(null);onSuccess(result);}
    catch(e){setError(e instanceof Error?e.message:'批量取消失敗，請重試。');}finally{setBusy(false);}
  }
  return <><Button type="button" variant="outline" className="text-rose-700" disabled={disabled||busy} onClick={preview}>批量取消工作並停用排程</Button>
    {!pending&&error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
    <Dialog open={pending!==null} onOpenChange={open=>{if(!open&&!busy){setPending(null);setError('');}}}><DialogContent><DialogHeader><DialogTitle>批量取消工作並停用排程？</DialogTitle><DialogDescription>依下列序號取消所有排隊中、同步中及失敗的工作，不受最近 30 筆限制。即使設備沒有待處理工作，也會停用定期同步。保留已完成紀錄、下載進度與本機／S3 量測資料；未建檔序號會略過並回報。</DialogDescription></DialogHeader>
      <p>本次確認設備：{pending?.length||0} 台</p><p className="max-h-48 overflow-auto break-words text-sm">{pending?.join('、')}</p>
      {error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>{setPending(null);setError('');}}>返回</Button><Button type="button" variant="destructive" disabled={busy||!pending} onClick={()=>void cancel()}>{busy?'處理中…':'確認批量取消並停用'}</Button></div>
    </DialogContent></Dialog>
  </>;
}
