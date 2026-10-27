import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {PostError,listPosts,getPost,savePost} from '@/lib/posts.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){return fail(e instanceof PostError?new AppError(e.status,e.message):e);}
export async function GET(req:Request){try{
  const me=await identity(req),url=new URL(req.url),manage=url.searchParams.get('manage')==='1';
  const id=url.searchParams.get('id');
  const result=id?getPost(getConnection(),me,id,{manage}):listPosts(getConnection(),me,{
    type:url.searchParams.get('kind')||'news',manage,status:url.searchParams.get('status')||'all',
    q:url.searchParams.get('q')||'',page:Number(url.searchParams.get('page')||1),
  });
  return Response.json(result,{headers});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  writeGuard(req);const me=await identity(req);
  if(me.role!=='admin')throw new AppError(403,'只有系統管理員可以發布或管理內容。');
  const raw=await req.text();if(new TextEncoder().encode(raw).length>256000)throw new AppError(413,'貼文內容過大。');
  let body;try{body=JSON.parse(raw);}catch{throw new AppError(400,'貼文格式不正確。');}
  return Response.json(savePost(getConnection(),me,body),{headers});
}catch(e){return failure(e);}}
