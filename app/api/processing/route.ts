import {identity,writeGuard,AppError,fail,permitted,required,instant} from '@/lib/server';
import {canExportData} from '@/lib/permissions.mjs';
import {getConnection} from '@/lib/store.mjs';
import {ensureProcessingSchema,enqueueProcessing,retryProcessing,saveProcessingSchedule,readProcessingResult} from '@/lib/processing-jobs.mjs';
import {csvChunks,csvZipResponse} from '@/lib/csv-zip.mjs';
import {exportName} from '@/lib/export-name.mjs';
import {globalProcessingSettings,saveGlobalProcessing} from '@/lib/global-processing.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store'};
export async function GET(req:Request){try{
  const me=await identity(req),d=getConnection();ensureProcessingSchema(d);const q=new URL(req.url).searchParams;
  if(q.has('id')){
    const job=d.prepare('SELECT * FROM processing_jobs WHERE id=?').get(required(q.get('id'),80));
    if(!job)throw new AppError(404,'工作不存在。');
    await permitted(me,job.device,job.start,job.end);
    if(q.get('detail')==='1'){
      if(me.role!=='admin')throw new AppError(403,'工作詳細資料僅供系統管理員使用。');
      const upload=d.prepare('SELECT status,last_error,attempts,retry_at FROM processing_uploads WHERE job_id=?').get(job.id);
      return Response.json({job:{id:job.id,device:job.device,start:job.start,end:job.end,status:job.status,rows_done:job.rows_done,
        recipe:JSON.parse(job.recipe),summary:JSON.parse(job.summary),error:job.error,attempts:job.attempts,
        actor:job.actor,created_at:job.created_at,finished_at:job.finished_at,context_start:job.context_start,context_end:job.context_end,
        upload_status:upload?.status||null,upload_error:upload?.last_error||'',upload_attempts:upload?.attempts||0,upload_retry_at:upload?.retry_at||null}},{headers:noStore});
    }
    if(job.status!=='COMPLETED')throw new AppError(409,'工作尚未完成。');
    // A precomputed Ghost Peak result can depend on samples outside the displayed interval.
    // Members must also hold permission for those actual context samples.
    if(me.role!=='admin')await permitted(me,job.device,job.context_start||job.start,job.context_end||job.end);
    const download=q.get('download')==='1';
    if(download&&!canExportData(me))throw new AppError(403,'此帳號沒有下載權限。');
    if(download)return await csvZipResponse(csvChunks(readProcessingResult(job)),exportName(job.device,job.start,job.end,{endExclusive:true}));
    const iterator=readProcessingResult(job)[Symbol.asyncIterator]();
    const offset=Number(q.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)throw new AppError(400,'分頁不正確。');
    const rows=[];let seen=0,hasMore=false;
    try{for await(const row of {[Symbol.asyncIterator]:()=>iterator}){if(seen++<offset)continue;if(rows.length===200){hasMore=true;break;}rows.push(row);}}
    finally{await iterator.return?.();}
    return Response.json({job:{id:job.id,device:job.device,start:job.start,end:job.end,recipe:JSON.parse(job.recipe),summary:JSON.parse(job.summary)},data:rows,offset,hasMore},{headers:noStore});
  }
  if(me.role!=='admin')throw new AppError(403,'背景工作總覽僅供系統管理員使用。');
  const page=Number(q.get('page')||1),pageSize=Number(q.get('page_size')||20);
  if(!Number.isSafeInteger(page)||page<1||page>100000000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new AppError(400,'分頁參數不正確。');
  const clauses:string[]=[],values:string[]=[];
  const device=q.get('device')?.trim(),status=q.get('status');
  if(device){if(!/^[A-Za-z0-9_-]{1,80}$/.test(device))throw new AppError(400,'設備 ID 不正確。');clauses.push('j.device=? COLLATE NOCASE');values.push(device);}
  if(status){if(!['QUEUED','RUNNING','COMPLETED','FAILED'].includes(status))throw new AppError(400,'工作狀態不正確。');clauses.push('j.status=?');values.push(status);}
  const day=(value:string)=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new AppError(400,'日期格式不正確。');
    const time=Date.parse(value+'T00:00:00+08:00');
    if(!Number.isFinite(time)||new Date(time+8*3600000).toISOString().slice(0,10)!==value)throw new AppError(400,'日期不正確。');
    return time;
  };
  const from=q.get('from'),to=q.get('to');
  const lower=from?day(from):null,upper=to?day(to):null;
  if(lower!==null&&upper!==null&&lower>upper)throw new AppError(400,'結束日期不可早於開始日期。');
  if(lower!==null){clauses.push('j.end>?');values.push(new Date(lower).toISOString());}
  if(upper!==null){clauses.push('j.start<?');values.push(new Date(upper+86400000).toISOString());}
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
  const total=Number(d.prepare('SELECT COUNT(*) AS n FROM processing_jobs j'+where).get(...values).n);
  const pages=Math.max(1,Math.ceil(total/pageSize)),currentPage=Math.min(page,pages);
  return Response.json({global:globalProcessingSettings(d),pagination:{page:currentPage,pageSize,total,pages},jobs:d.prepare(`SELECT j.id,j.device,j.start,j.end,j.recipe,j.status,j.rows_done,j.error,j.attempts,j.created_at,j.finished_at,
    u.status AS upload_status,u.last_error AS upload_error,u.attempts AS upload_attempts,u.retry_at AS upload_retry_at
    FROM processing_jobs j LEFT JOIN processing_uploads u ON u.job_id=j.id${where} ORDER BY j.created_at DESC,j.id DESC LIMIT ? OFFSET ?`).all(...values,pageSize,(currentPage-1)*pageSize),schedules:d.prepare('SELECT * FROM processing_schedules ORDER BY device').all()},{headers:noStore});
}catch(e){return fail(e);}}
export async function POST(req:Request){try{
  writeGuard(req);const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'背景工作設定僅供系統管理員使用。');
  const p=await req.json();if(!p||typeof p!=='object'||Array.isArray(p))throw new AppError(400,'表單內容不正確。');
  const d=getConnection();ensureProcessingSchema(d);
  try{
    if(p.action==='global'){saveGlobalProcessing(d,{enabled:p.enabled,upLimit:p.upLimit,actor:me.email});return Response.json({ok:true});}
    if(p.action==='retry'){retryProcessing(d,required(p.id,80));return Response.json({ok:true});}
    const device=required(p.device,80);
    if(!d.prepare('SELECT id FROM devices WHERE id=?').get(device))throw new AppError(404,'找不到設備。');
    if(p.action==='schedule'){saveProcessingSchedule(d,{device,upLimit:p.upLimit,enabled:p.enabled,actor:me.email});return Response.json({ok:true});}
    if(p.action!=='enqueue')throw new AppError(400,'不支援的操作。');
    const start=instant(p.start),end=instant(p.end);
    if(end<=start||Date.parse(end)-Date.parse(start)>31*86400000)throw new AppError(400,'每次可建立最多 31 天的工作，結束時間不包含。');
    const ids:string[]=[];const refresh=p.refresh===true?crypto.randomUUID():'';
    d.exec('BEGIN IMMEDIATE');try{
      for(let a=Date.parse(start);a<Date.parse(end);a+=86400000)ids.push(enqueueProcessing(d,{device,start:new Date(a).toISOString(),end:new Date(Math.min(a+86400000,Date.parse(end))).toISOString(),upLimit:p.upLimit,actor:me.email,refresh}));
      d.exec('COMMIT');
    }catch(e){d.exec('ROLLBACK');throw e;}
    return Response.json({ok:true,ids});
  }catch(e){if(e instanceof AppError)throw e;throw new AppError(400,(e as Error).message);}
}catch(e){return fail(e);}}
