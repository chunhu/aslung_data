import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {MaintainerLinkError,maintainerLinkDetails,saveMaintainerLinks} from '@/lib/maintainer-links.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
function failure(e:unknown){return e instanceof MaintainerLinkError?Response.json({error:e.message},{status:e.status,headers:{'Cache-Control':'no-store'}}):fail(e);}
export async function GET(req:Request){try{
  const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'只有管理員可以設定維護身分關聯。');
  return Response.json(maintainerLinkDetails(getConnection(),me,new URL(req.url).searchParams.get('email')||''),{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  writeGuard(req);const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'只有管理員可以設定維護身分關聯。');
  return Response.json(saveMaintainerLinks(getConnection(),me,await req.json()));
}catch(e){return failure(e);}}
