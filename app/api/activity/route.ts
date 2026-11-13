import {getConnection} from '@/lib/store.mjs';
import {queryActivity,pruneActivity,ActivityError} from '@/lib/activity.mjs';
import {identity,AppError,fail} from '@/lib/server';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){try{
  const me=await identity(request);if(me.role!=='admin')throw new AppError(403,'只有系統管理員可以查看使用紀錄。');
  const params=new URL(request.url).searchParams,d=getConnection();pruneActivity(d);
  return Response.json(queryActivity(d,{kind:params.get('kind')||'',q:params.get('q')||'',from:params.get('from')||'',to:params.get('to')||'',before:Number(params.get('before')||0)}),{headers:{'Cache-Control':'private, no-store'}});
}catch(e){return fail(e instanceof ActivityError?new AppError(e.status,e.message):e);}}
