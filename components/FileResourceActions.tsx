"use client";
import {Button} from '@/components/ui/button';
import {Download,Eye,ExternalLink} from 'lucide-react';

type Resource={id:string;name:string;external_url?:string|null;download_count?:number};
export default function FileResourceActions({file,onDownload,isEnglish=false}:{file:Resource;onDownload:()=>void;isEnglish?:boolean}){
  const href=`/api/files?id=${encodeURIComponent(file.id)}`;
  if(file.external_url)return <Button size="sm" variant="outline" asChild><a href={`${href}&download=1`} target="_blank" rel="noopener noreferrer" onClick={onDownload}><ExternalLink size={14}/>{isEnglish?'Open download link':'開啟下載連結'}<span className="text-xs text-slate-500">{file.download_count||0}{isEnglish?' opens':' 次'}</span></a></Button>;
  return <><Button size="sm" variant="outline" title={isEnglish?'View in new tab':'在新分頁檢視'} onClick={()=>window.open(`${href}&view=1`,'_blank','noopener,noreferrer')}><Eye size={14}/>{isEnglish?'View':'檢視'}</Button><Button size="sm" variant="outline" onClick={()=>{const a=document.createElement('a');a.href=`${href}&download=1`;a.download=file.name;a.click();onDownload();}}><Download size={14}/>{isEnglish?'Download':'下載'}<span className="text-xs text-slate-500">{file.download_count||0}{isEnglish?' downloads':' 次'}</span></Button></>;
}
