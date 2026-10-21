import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {cleanupStatus,previewCleanup,confirmCleanup,retryCleanup} from '@/lib/processing-cleanup.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){
  if(e instanceof AppError)return fail(e);
  if((e as any).$metadata?.httpStatusCode===403||(e as Error).name==='AccessDenied')return fail(new AppError(403,'S3 清除權限不足，請先在 EC2 Role 新增 scripts/iam-calibration-cleanup.json 的補充政策，再重新預覽。'));
  return fail(new AppError((e as any).status||500,(e as Error).message));
}
export async function GET(req:Request){try{
  const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'僅系統管理員可查看清除記錄。');
  return Response.json(cleanupStatus(getConnection()),{headers});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  writeGuard(req);const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'僅系統管理員可清除校正成果。');
  const body=await req.json();if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError(400,'表單內容不正確。');
  const d=getConnection();
  if(body.action==='preview'){
    if(body.filters!==undefined&&(!body.filters||typeof body.filters!=='object'||Array.isArray(body.filters)))throw new AppError(400,'篩選條件不正確。');
    return Response.json(await previewCleanup(d,{filters:body.filters,actor:me.email}),{headers});
  }
  if(body.action==='confirm')return Response.json(await confirmCleanup(d,{id:body.id,actor:me.email,confirmation:body.confirmation,pauseSchedules:body.pauseSchedules}),{headers});
  if(body.action==='retry'){retryCleanup(d,body.id);return Response.json({ok:true},{headers});}
  throw new AppError(400,'不支援的操作。');
}catch(e){return failure(e);}}
