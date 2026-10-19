import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {AccessError,ensureMemberAccessSchema,saveMemberAccess} from '@/lib/member-access.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
function failure(e:unknown){return e instanceof AccessError?Response.json({error:e.message},{status:e.status,headers:{'Cache-Control':'no-store'}}):fail(e);}
export async function GET(req:Request){try{
  const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'只有系統管理員可以管理權限。');
  const d=getConnection();ensureMemberAccessSchema(d);const email=new URL(req.url).searchParams.get('email')||'';
  if(!d.prepare('SELECT 1 FROM members WHERE email=?').get(email))throw new AppError(404,'會員不存在。');
  return Response.json({device_ids:d.prepare('SELECT device_id FROM member_device_scopes WHERE email=?').all(email).map((r:any)=>r.device_id),events:d.prepare('SELECT * FROM member_access_events WHERE target_email=? ORDER BY id DESC LIMIT 30').all(email)},{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{writeGuard(req);const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'只有系統管理員可以管理權限。');return Response.json(saveMemberAccess(getConnection(),me,await req.json()));}catch(e){return failure(e);}}
