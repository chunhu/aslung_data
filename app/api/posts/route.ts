import {limitedJson,HttpSecurityError} from '@/lib/http-security.mjs';
import {auditOperation} from "@/lib/activity-server";
import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {PostError,listPosts,getPost,savePost,listPublicPosts,getPublicPost} from '@/lib/posts.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){return fail(e instanceof PostError||e instanceof HttpSecurityError?new AppError(e.status,e.message):e);}
export async function GET(req:Request){try{
  const url=new URL(req.url);
  if(url.searchParams.get('public')==='1'){
    if(url.searchParams.get('manage')==='1')throw new AppError(400,'公開文章入口不提供管理模式。');
    const id=url.searchParams.get('id');
    return Response.json(id?getPublicPost(getConnection(),id):listPublicPosts(getConnection(),{type:url.searchParams.get('kind')||null,q:url.searchParams.get('q')||'',page:Number(url.searchParams.get('page')||1)}),{headers});
  }
  const me=await identity(req),manage=url.searchParams.get('manage')==='1';
  const id=url.searchParams.get('id');
  const result=id?getPost(getConnection(),me,id,{manage}):listPosts(getConnection(),me,{
    type:url.searchParams.get('kind')||'news',manage,status:url.searchParams.get('status')||'all',
    q:url.searchParams.get('q')||'',page:Number(url.searchParams.get('page')||1),
  });
  return Response.json(result,{headers});
}catch(e){return failure(e);}}
async function handlePOST(req: Request){try{
  writeGuard(req);const me=await identity(req);
  if(me.role!=='admin')throw new AppError(403,'只有系統管理員可以發布或管理內容。');
  const body=await limitedJson(req,1500000);
  const current=await identity(req);if(current.role!=='admin')throw new AppError(403,'管理權限已變更，請重新登入。');
  return Response.json(savePost(getConnection(),current,body),{headers});
}catch(e){return failure(e);}}

export async function POST(request:Request){return auditOperation(request,()=>handlePOST(request as any));}
