import {identity,writeGuard,AppError,fail,permitted,required,instant} from '@/lib/server';
import {canExportData} from '@/lib/permissions.mjs';
import {getConnection} from '@/lib/store.mjs';
import {ensureProcessingSchema,enqueueProcessing,retryProcessing,saveProcessingSchedule,readProcessingResult} from '@/lib/processing-jobs.mjs';
import {csvChunks,csvZipResponse} from '@/lib/csv-zip.mjs';
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
    if(job.status!=='COMPLETED')throw new AppError(409,'工作尚未完成。');
    // A precomputed Ghost Peak result can depend on samples outside the displayed interval.
    // Members must also hold permission for those actual context samples.
    if(me.role!=='admin')await permitted(me,job.device,job.context_start||job.start,job.context_end||job.end);
    const download=q.get('download')==='1';
    if(download&&!canExportData(me))throw new AppError(403,'此帳號沒有下載權限。');
    if(download)return await csvZipResponse(csvChunks(readProcessingResult(job)),`processed_${job.id}`);
    const iterator=readProcessingResult(job)[Symbol.asyncIterator]();
    const offset=Number(q.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)throw new AppError(400,'分頁不正確。');
    const rows=[];let seen=0,hasMore=false;
    try{for await(const row of {[Symbol.asyncIterator]:()=>iterator}){if(seen++<offset)continue;if(rows.length===200){hasMore=true;break;}rows.push(row);}}
    finally{await iterator.return?.();}
    return Response.json({job:{id:job.id,device:job.device,start:job.start,end:job.end,recipe:JSON.parse(job.recipe),summary:JSON.parse(job.summary)},data:rows,offset,hasMore},{headers:noStore});
  }
  if(me.role!=='admin')throw new AppError(403,'背景工作總覽僅供系統管理員使用。');
  return Response.json({global:globalProcessingSettings(d),jobs:d.prepare(`SELECT j.id,j.device,j.start,j.end,j.recipe,j.status,j.rows_done,j.summary,j.error,j.attempts,j.created_at,j.finished_at,
    u.status AS upload_status,u.last_error AS upload_error,u.attempts AS upload_attempts,u.retry_at AS upload_retry_at
    FROM processing_jobs j LEFT JOIN processing_uploads u ON u.job_id=j.id ORDER BY j.created_at DESC LIMIT 100`).all(),schedules:d.prepare('SELECT * FROM processing_schedules ORDER BY device').all()},{headers:noStore});
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
