"use client";
import {useEffect,useRef,useState} from 'react';
import {formatInTimeZone,fromZonedTime} from 'date-fns-tz';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import HoboDeviceSelect from '@/components/HoboDeviceSelect';
type Props={api:(url:string,options?:RequestInit)=>Promise<any>;loggers:any[];selectedSerial:string;timezone:string;refreshKey:number};
const columns=[['timestamp','時間（UTC）'],['logger_sn','設備序號'],['sensor_sn','感測器序號'],['sensor_measurement_type','量測項目'],['value','數值'],['unit','單位'],['data_type','資料類型'],['data_type_id','類型 ID']];
const measurements=[['Temperature','溫度'],['RH','相對濕度'],['Dew Point','露點'],['Wind Direction','風向'],['Wind Speed','風速'],['Gust Speed','陣風'],['PAR','PAR'],['Solar Radiation','日射量'],['Rain','降雨'],['Battery','電池']];
export default function HoboDataSearch({api,loggers,selectedSerial,timezone,refreshKey}:Props){
  const [serial,setSerial]=useState(selectedSerial),[start,setStart]=useState(()=>formatInTimeZone(new Date(Date.now()-7*86400000),timezone,"yyyy-MM-dd'T'HH:mm")),[end,setEnd]=useState(()=>formatInTimeZone(new Date(),timezone,"yyyy-MM-dd'T'HH:mm"));
  const [measurement,setMeasurement]=useState(''),[sensor,setSensor]=useState(''),[q,setQ]=useState('');
  const [rows,setRows]=useState<any[]>([]),[next,setNext]=useState<number|null>(null),[queried,setQueried]=useState(false),[download,setDownload]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generation=useRef(0),pending=useRef<AbortController|null>(null);
  useEffect(()=>{setSerial(selectedSerial);},[selectedSerial]);
  useEffect(()=>{
    generation.current++;pending.current?.abort();setRows([]);setNext(null);setQueried(false);setDownload('');setError('');setBusy(false);
    return()=>{generation.current++;pending.current?.abort();};
  },[serial,start,end,measurement,sensor,q,timezone,refreshKey]);
  async function search(after=0){
    pending.current?.abort();const controller=new AbortController();pending.current=controller;
    const current=++generation.current;setBusy(true);setError('');
    if(!after){setRows([]);setQueried(false);setDownload('');}
    try{
      if(!serial||!start||!end)throw new Error('請選擇設備及起訖時間。');
      const a=fromZonedTime(start,timezone),b=fromZonedTime(end,timezone);
      if(!Number.isFinite(+a)||!Number.isFinite(+b)||a>b)throw new Error('請確認開始及結束時間。');
      const params=new URLSearchParams({serial,start:a.toISOString(),end:b.toISOString(),measurement,sensor:sensor.trim(),q:q.trim(),action:'query',after:String(after)});
      const result=await api('/api/hobo?'+params,{signal:controller.signal});if(current!==generation.current)return;
      setRows(previous=>after?[...previous,...result.rows]:result.rows);setNext(result.next);setQueried(true);
      params.set('action','csv');params.delete('after');setDownload('/api/hobo?'+params);
    }catch(e){if(current===generation.current&&!controller.signal.aborted)setError((e as Error).message);}
    finally{if(current===generation.current)setBusy(false);}
  }
  return <section className="panel p-6 space-y-4"><div><h3 className="font-semibold text-lg">HOBO 資料搜尋</h3><p className="text-xs text-slate-500 mt-1">搜尋已匯入的本機及 S3 資料。日期依 {timezone} 輸入；清單與 CSV 時間為 UTC。各條件共同篩選，下載套用相同條件。</p></div>
    <form onSubmit={e=>{e.preventDefault();void search();}} className="space-y-3"><div className="grid gap-3 md:grid-cols-3"><div className="text-sm space-y-1"><p>設備</p><HoboDeviceSelect loggers={loggers} value={serial} onChange={setSerial} label="選擇查詢設備"/></div><label className="text-sm">開始時間<Input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} required/></label><label className="text-sm">結束時間<Input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} required/></label><label className="text-sm">量測項目<select aria-label="量測項目" className="block h-10 w-full rounded border bg-white px-2" value={measurement} onChange={e=>setMeasurement(e.target.value)}><option value="">全部量測項目</option>{measurements.map(([value,label])=><option key={value} value={value}>{label} ({value})</option>)}</select></label><label className="text-sm">感測器序號<Input placeholder="輸入完整或部分 Sensor SN" maxLength={160} value={sensor} onChange={e=>setSensor(e.target.value)}/></label><label className="text-sm">資料關鍵字<Input placeholder="量測名稱、單位、數值或資料類型" maxLength={160} value={q} onChange={e=>setQ(e.target.value)}/></label></div><div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={busy||!loggers.length}>{busy?'搜尋中…':'搜尋資料'}</Button><Button type="button" variant="outline" onClick={()=>{setMeasurement('');setSensor('');setQ('');}}>清除資料篩選</Button>{queried&&download&&<a className="text-teal-700 underline text-sm" href={download}>下載全部符合資料（CSV）</a>}</div></form>
    {error&&<p role="alert" className="text-rose-700">{error}</p>}
    {queried&&<><p role="status" className="text-sm text-slate-600">已載入 {rows.length} 筆符合資料{next!==null?'，可繼續載入更多。':'。'}</p><div className="max-h-[32rem] overflow-auto rounded border"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="sticky top-0 bg-slate-50"><tr>{columns.map(([key,label])=><th className="p-3" key={key}>{label}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i} className="border-t">{columns.map(([key])=><td className="p-3" key={key}>{String(row[key]??'—')}</td>)}</tr>)}</tbody></table>{!rows.length&&<p className="p-4 text-sm text-slate-500">沒有符合的已匯入資料；可調整設備、日期或搜尋條件，或先確認同步工作已完成。</p>}</div>{next!==null&&<Button variant="outline" disabled={busy} onClick={()=>void search(next)}>載入更多符合資料</Button>}</>}
  </section>;
}
