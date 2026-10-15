import {identity,db,AppError,fail} from "@/lib/server";
import {getPool} from "@/lib/data";
import {discoverRealtimeDevices} from "@/lib/realtime-discovery.mjs";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:Request){
  try{
    const me=await identity(req);
    if(me.role!=="admin")throw new AppError(403,"只有管理員可以搜尋未建檔設備。");
    const days=Number(new URL(req.url).searchParams.get('days')||7);
    if(![1,7,30,365].includes(days))throw new AppError(400,"請選擇有效搜尋期間。");
    const registered=(await db().prepare('SELECT id FROM devices').all()).results as {id:string}[];
    const result=await discoverRealtimeDevices(getPool(),registered.map(d=>d.id),days);
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(e){return fail(e);}
}
