"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {formatInTimeZone,fromZonedTime} from 'date-fns-tz';
import preset from '@/lib/hobo-rcec-loggers.json';
import HoboCleanup from '@/components/HoboCleanup';
import HoboSyncJobs from '@/components/HoboSyncJobs';
import HoboDeviceSelect from '@/components/HoboDeviceSelect';
import HoboDataSearch from '@/components/HoboDataSearch';
import HoboDeviceOverview from '@/components/HoboDeviceOverview';
import HoboBatchCancel from '@/components/HoboBatchCancel';
type Props={api:(url:string,options?:RequestInit)=>Promise<any>;timezone:string};
export default function HoboView({api,timezone}:Props){
  const [status,setStatus]=useState<any>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [serial,setSerial]=useState(''),[name,setName]=useState(''),[enabled,setEnabled]=useState(false);
  const [batchSerials,setBatchSerials]=useState(preset.serials.join('\n')),[batchStart,setBatchStart]=useState(preset.startDateTaipei),[batchEnabled,setBatchEnabled]=useState(false);
  const [start,setStart]=useState(()=>formatInTimeZone(new Date(Date.now()-7*86400000),timezone,"yyyy-MM-dd'T'HH:mm"));
  const [end,setEnd]=useState(()=>formatInTimeZone(new Date(),timezone,"yyyy-MM-dd'T'HH:mm"));
  const [searchRefresh,setSearchRefresh]=useState(0);
  const [scheduleStart,setScheduleStart]=useState(start),[expectedSchedule,setExpectedSchedule]=useState<{sync_from:string;enabled:number}|null>(null);
  async function refresh(){try{setStatus(await api('/api/hobo'));}catch(e){setError((e as Error).message);}}
  useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>clearInterval(timer);},[api]);
  function range(){
    if(!serial||!start||!end)throw new Error('請填寫設備序號及日期範圍。');
    const a=fromZonedTime(start,timezone),b=fromZonedTime(end,timezone);
    if(!Number.isFinite(+a)||!Number.isFinite(+b)||a>b)throw new Error('請確認開始及結束時間。');
    return {serial,start:a.toISOString(),end:b.toISOString()};
  }
  async function perform(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function save(){await perform(async()=>{
    if(!serial||!scheduleStart)throw new Error('請填寫設備序號與自動同步起日。');
    const origin=fromZonedTime(scheduleStart,timezone);if(!Number.isFinite(+origin))throw new Error('請確認自動同步起日。');
    await api('/api/hobo',{method:'POST',body:JSON.stringify({action:'save',serial,name,start:origin.toISOString(),scheduleStart:origin.toISOString(),enabled,expectedSchedule})});
    setNotice('已儲存設備與自動同步起日。手動匯入及資料搜尋日期不會修改排程起日；變更起日會重設同步進度，保留量測資料。');await refresh();
  });}
  async function sync(){await perform(async()=>{await api('/api/hobo',{method:'POST',body:JSON.stringify({action:'sync',...range()})});setNotice('已加入指定範圍匯入佇列；此操作不會修改自動同步起日。若仍啟用每小時同步，之後會依設備已儲存的排程起日與進度執行。');await refresh();});}
  function choose(logger:any){setSerial(logger.serial);setName(logger.name);setEnabled(!!logger.enabled);if(logger.sync_from){setScheduleStart(formatInTimeZone(new Date(logger.sync_from),timezone,"yyyy-MM-dd'T'HH:mm:ss"));setExpectedSchedule({sync_from:logger.sync_from,enabled:logger.enabled});}}
  async function batch(queue:boolean){await perform(async()=>{
    const serials=[...new Set(batchSerials.trim().split(/[\s,，;；]+/).filter(Boolean))];
    if(!batchStart||!serials.length)throw new Error('請填寫設備序號及起日。');
    const result=await api('/api/hobo',{method:'POST',body:JSON.stringify({action:'batch',serials,start:fromZonedTime(batchStart+'T00:00:00','Asia/Taipei').toISOString(),end:new Date().toISOString(),enabled:batchEnabled,queue})});
    setNotice(`已儲存 ${result.saved} 台；加入 ${result.queued} 個匯入工作；${result.skipped} 台已有工作，保留原進度。`);await refresh();
  });}
  const selectedLogger=status?.loggers.find((logger:any)=>logger.serial===serial);
  useEffect(()=>{
    if(selectedLogger?.sync_from){
      setScheduleStart(formatInTimeZone(new Date(selectedLogger.sync_from),timezone,"yyyy-MM-dd'T'HH:mm:ss"));
      setEnabled(!!selectedLogger.enabled);setExpectedSchedule({sync_from:selectedLogger.sync_from,enabled:selectedLogger.enabled});
    }else setExpectedSchedule(null);
  },[serial,selectedLogger?.sync_from,selectedLogger?.enabled,timezone]);
  return <div className="space-y-5"><section className="panel p-6 space-y-4"><div><h2 className="text-xl font-semibold">HOBO / LI-COR 資料</h2><p className="mt-2 text-sm text-slate-500">管理員專用。保留感測器、原始數值與單位，獨立儲存，不套用 ASLUNG PM 校正。日期依 {timezone} 輸入；CSV timestamp 為 UTC。CSV 檔名日期使用臺灣時間。</p></div>
    {status&&!status.configured&&<p role="alert" className="rounded bg-amber-50 p-3 text-amber-800">尚未設定伺服器 LICOR_API_TOKEN。請在 EC2 .env 設定後重新建立 app 及 calibration-worker 容器。</p>}
    {status?.storage_error&&<p role="alert" className="rounded bg-rose-50 p-3 text-rose-800">S3 歸檔暫停：{status.storage_error}。歸檔恢復前暫停抓取新資料，已抓取資料仍保留本機。</p>}
    <p className="text-sm text-slate-500">儲存模式：{status?.storage==='s3'?'S3（本機僅保留待上傳資料）':'本機 SQLite'}。定期同步需啟動 calibration-worker。設備需先儲存，再執行指定範圍匯入。API 沒有設備清單端點，請從 LI-COR 網站取得 Logger Serial Number。</p>
    <div className="grid gap-4 md:grid-cols-2"><div className="space-y-1"><h3 className="font-semibold">HOBO 設備（{status?.loggers.length||0} 台）</h3><HoboDeviceSelect loggers={status?.loggers||[]} value={selectedLogger?.serial||''} onChange={id=>{const logger=status?.loggers.find((l:any)=>l.serial===id);if(logger)choose(logger);}}/>{status&&!status.loggers.length&&<p className="text-xs text-slate-500">尚未新增設備，可展開下方設定。</p>}</div>{selectedLogger&&<dl className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm"><div><dt className="text-xs text-slate-500">每小時同步</dt><dd>{selectedLogger.enabled?'啟用':'停用'}</dd></div><div><dt className="text-xs text-slate-500">本機／S3 筆數</dt><dd>{selectedLogger.observations} / {selectedLogger.archived||0}</dd></div><div className="col-span-2"><dt className="text-xs text-slate-500">已儲存的自動同步起日（UTC）</dt><dd>{selectedLogger.sync_from||'—'}</dd></div><div className="col-span-2"><dt className="text-xs text-slate-500">最新量測（UTC）</dt><dd>{selectedLogger.latest||'—'}</dd></div></dl>}</div>
    <HoboDeviceOverview api={api} loggers={status?.loggers||[]} selectedSerial={selectedLogger?.serial||''} refreshKey={searchRefresh} onSelect={id=>{const logger=status?.loggers.find((l:any)=>l.serial===id);if(logger)choose(logger);}}/>
    <details className="rounded-lg border p-4"><summary className="font-semibold cursor-pointer">新增、歷史匯入與排程設定</summary><div className="mt-4 space-y-4"><details className="rounded-lg border p-4"><summary className="font-semibold cursor-pointer">批次新增與歷史匯入（目前填入 {new Set(batchSerials.trim().split(/[\s,，;；]+/).filter(Boolean)).size} 台）</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><label className="text-sm">設備序號（每行一台，可編輯）<textarea aria-label="批次設備序號" className="block mt-1 w-full rounded border p-2 font-mono" rows={6} value={batchSerials} onChange={e=>setBatchSerials(e.target.value)}/></label><div className="space-y-3"><label className="block text-sm">歷史匯入起日（臺灣時間，至執行當下）<Input type="date" value={batchStart} onChange={e=>setBatchStart(e.target.value)}/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={batchEnabled} onChange={e=>setBatchEnabled(e.target.checked)}/>同時啟用每小時同步</label><p className="text-xs text-slate-500">名稱預設 RCEC_序號。勾選每小時同步時，此起日也會更新沒有執行中工作的設備排程起日；未勾選時，既有排程起日保留。歷史資料按月分段、月內按日輪流抓取；完成一個月後暫停，再接續下個月。HTTP 200 但無資料僅代表所查區間為空，無法單憑此結果確認設備權限。</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={()=>void batch(false)}>僅儲存批次設備</Button><Button disabled={busy||!status?.configured} onClick={()=>void batch(true)}>儲存並從起日匯入至今</Button><HoboBatchCancel api={api} serialsText={batchSerials} disabled={busy} onSuccess={result=>{setError('');setBatchEnabled(false);setNotice(`已處理 ${result.matched} 台，停用 ${result.disabled} 台原已啟用排程，取消 ${result.cancelled} 筆工作。${result.missing.length?`未建檔略過：${result.missing.join('、')}。`:''}已下載資料保留。`);void refresh();}}/></div></div></div></details>
    <p className="text-xs text-slate-500">全部設備共用每次至少 {(status?.request_interval_ms||15000)/1000} 秒的 API 請求間隔；資料量超限時的切分請求也會等待。HTTP 429／509 會暫停全部設備並延後重試。</p><div className="grid gap-4 md:grid-cols-3"><label className="text-sm">設備序號<Input value={serial} onChange={e=>setSerial(e.target.value.trim())} placeholder="Logger Serial Number"/></label><label className="text-sm">設備名稱<Input value={name} onChange={e=>setName(e.target.value)} maxLength={120}/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>每小時同步（預設關閉）</label><label className="text-sm">自動同步起日（{timezone}）<Input aria-label="自動同步起日" type="datetime-local" step="1" value={scheduleStart} onChange={e=>setScheduleStart(e.target.value)}/></label><label className="text-sm">手動匯入開始時間<Input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label className="text-sm">手動匯入結束時間<Input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
    <p className="text-xs text-slate-500">自動同步起日只在按「儲存設備與排程」時更新，與手動匯入、資料搜尋日期分開。修改既有起日會重設排程進度；如有排隊或執行中工作，請先取消。工作最終失敗時自動停用每小時同步，需手動檢查後恢復。重複匯入會依感測器與時間更新，不新增重複紀錄。</p>
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>void save()}>儲存設備與排程</Button><Button variant="outline" disabled={busy||!status?.configured} onClick={()=>void sync()}>匯入指定範圍</Button><Button variant="outline" disabled={busy} onClick={()=>void refresh()}>重新整理</Button></div>
    </div></details>
    {error&&<p role="alert" className="text-rose-700">{error}</p>}{notice&&<p role="status" className="text-teal-800">{notice}</p>}{busy&&<p role="status">處理中…</p>}
  </section>
  <HoboDataSearch api={api} loggers={status?.loggers||[]} selectedSerial={selectedLogger?.serial||''} timezone={timezone} refreshKey={searchRefresh}/>
  <HoboSyncJobs api={api} jobs={status?.jobs||[]} totalJobs={status?.jobs_total} loggers={status?.loggers||[]} timezone={timezone} onChange={()=>void refresh()}/>
  <details className="rounded-lg border border-rose-200 bg-white p-4"><summary className="cursor-pointer font-semibold text-rose-800">清除 HOBO 資料與清除記錄</summary><div className="mt-4"><HoboCleanup api={api} loggers={status?.loggers||[]} onChange={()=>{setSearchRefresh(value=>value+1);void refresh();}}/></div></details>
  </div>;
}
