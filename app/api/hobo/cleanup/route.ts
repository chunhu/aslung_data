import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {HoboError} from '@/lib/hobo.mjs';
import {previewHoboCleanup,confirmHoboCleanup,hoboCleanupStatus,retryHoboCleanup} from '@/lib/hobo-cleanup.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
async function access(req:Request){const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'僅管理員可清除 HOBO 資料。');return me;}
function failure(e:unknown){return fail(e instanceof HoboError?new AppError(e.status,e.message):e);}
export async function GET(req:Request){try{await access(req);return Response.json(hoboCleanupStatus(getConnection()),{headers});}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  writeGuard(req);const me=await access(req),body=await req.json(),d=getConnection();
  if(body?.action==='preview')return Response.json(previewHoboCleanup(d,body.filters,me.email),{headers});
  if(body?.action==='confirm')return Response.json(await confirmHoboCleanup(d,{id:body.id,actor:me.email,confirmation:body.confirmation}),{headers});
  if(body?.action==='retry'){retryHoboCleanup(d,body.id);return Response.json({ok:true},{headers});}
  throw new AppError(400,'不支援的操作。');
}catch(e){return failure(e);}}
