import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {HoboError,hoboStatus,saveHoboLogger,saveHoboBatch,queueHoboSync,retryHoboSync,cancelHoboSync,manageHoboJobs,hoboRange,hoboSerial} from '@/lib/hobo.mjs';
import {queryStoredHobo,storedHoboCsvStream,hoboDeviceOverview} from '@/lib/hobo-storage.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
async function access(req:Request){const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'僅管理員可操作 HOBO 資料。');return me;}
function failure(e:unknown){return fail(e instanceof HoboError?new AppError(e.status,e.message):e);}
export async function GET(req:Request){try{
  await access(req);const url=new URL(req.url),action=url.searchParams.get('action')||'status',d=getConnection();
  if(action==='status')return Response.json(hoboStatus(d),{headers});
  if(action==='overview')return Response.json(await hoboDeviceOverview(d),{headers});
  const serial=hoboSerial(url.searchParams.get('serial'));
  const {start,end}=hoboRange(url.searchParams.get('start'),url.searchParams.get('end'));
  const filters={measurement:url.searchParams.get('measurement')||'',sensor:url.searchParams.get('sensor')||'',q:url.searchParams.get('q')||''};
  if(action==='query')return Response.json(await queryStoredHobo(d,{serial,start,end,...filters,after:Number(url.searchParams.get('after')||0)}),{headers});
  if(action==='csv'){
    const date=(value:string)=>new Date(Date.parse(value)+8*3600000).toISOString().slice(0,10).replaceAll('-','');
    return new Response(await storedHoboCsvStream(d,{serial,start,end,...filters}),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="HOBO_${serial}_${date(start)}_${date(end)}.csv"`}});
  }
  throw new AppError(400,'不支援的操作。');
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  writeGuard(req);const me=await access(req);const body=await req.json();const d=getConnection();
  if(body?.action==='batch'){
    if(body.queue&&!process.env.LICOR_API_TOKEN?.trim())throw new AppError(503,'請先在 EC2 .env 設定 LICOR_API_TOKEN 並重建容器。');
    return Response.json(saveHoboBatch(d,{...body,actor:me.email}),{headers});
  }
  else if(body?.action==='save')saveHoboLogger(d,body);
  else if(body?.action==='sync'){
    if(!process.env.LICOR_API_TOKEN?.trim())throw new AppError(503,'請先在 EC2 .env 設定 LICOR_API_TOKEN 並重建容器。');
    return Response.json({id:queueHoboSync(d,{...body,actor:me.email})},{status:202,headers});
  }else if(body?.action==='retry')retryHoboSync(d,body.id);
  else if(body?.action==='cancel')return Response.json(cancelHoboSync(d,body.id),{headers});
  else if(body?.action==='jobsBulk')return Response.json(manageHoboJobs(d,body),{headers});
  else throw new AppError(400,'不支援的操作。');
  return Response.json({ok:true},{headers});
}catch(e){return failure(e);}}
