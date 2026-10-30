import {identity,writeGuard,AppError,fail,syncDeviceStatusesAndLocations} from "@/lib/server";
import {getConnection} from "@/lib/store.mjs";
import {quickUpdateDevice} from "@/lib/fleet-quick-edit.mjs";
import {ensureFleetSchema,updateFleetDevices,previewFleetImport,applyFleetImport,FleetError} from "@/lib/fleet-store.mjs";

export const runtime="nodejs";
export const dynamic="force-dynamic";
function failure(e: unknown) {
  if(e instanceof FleetError)return Response.json({error:e.message},{status:e.status});
  return fail(e);
}
export async function GET(req:Request) {
  try {
    const me=await identity(req);if(me.role!=="admin")throw new AppError(403,"只有管理員可以檢視設備歷程。");
    const id=new URL(req.url).searchParams.get("id");
    if(!id||id.length>80)throw new AppError(400,"請提供設備編號。");
    const d=getConnection();ensureFleetSchema(d);
    if(!d.prepare('SELECT id FROM devices WHERE id=?').get(id))throw new AppError(404,"設備不存在。");
    return Response.json({events:d.prepare('SELECT * FROM device_events WHERE device_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(id)}, {headers:{"Cache-Control":"no-store"}});
  }catch(e){return failure(e);}
}
export async function POST(req:Request) {
  try {
    writeGuard(req);const me=await identity(req);if(me.role!=="admin")throw new AppError(403,"只有管理員可以執行設備管理。");
    const p=await req.json();if(!p||typeof p!=="object"||Array.isArray(p))throw new AppError(400,"參數不正確。");
    const d=getConnection();
    if(p.action==="quick")return Response.json({ok:true,...quickUpdateDevice(d,p,me.email)});
    if(p.action==="bulk"){
      const result=updateFleetDevices(d,p,me.email);await syncDeviceStatusesAndLocations();
      return Response.json({ok:true,...result});
    }
    if(p.action==="googleSource"){
      let url:URL;try{url=new URL(p.url);}catch{throw new AppError(400,"請貼上 Google 試算表網址。");}
      const id=url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
      if(url.protocol!=="https:"||url.hostname!=="docs.google.com"||!id)throw new AppError(400,"請使用 docs.google.com 的試算表網址。");
      const gid=url.searchParams.get('gid')||new URLSearchParams(url.hash.slice(1)).get('gid');
      if(!gid||!/^\d+$/.test(gid))throw new AppError(400,"網址需包含 gid，請切換到要匯入的分頁後複製網址。");
      const res=await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`,{signal:AbortSignal.timeout(20000)});
      if(!res.ok)throw new AppError(400,`無法讀取試算表（HTTP ${res.status}），請確認該分頁可供伺服器讀取。`);
      const text=await res.text();
      if(text.length>2000000||/^\s*<!doctype html|^\s*<html/i.test(text))throw new AppError(400,"無法取得 CSV，請確認分享設定，或下載 CSV 後上傳。");
      return Response.json({text},{headers:{"Cache-Control":"no-store"}});
    }
    if(p.action==="previewImport")return Response.json(previewFleetImport(d,p),{headers:{"Cache-Control":"no-store"}});
    if(p.action==="applyImport"){
      const result=applyFleetImport(d,p,me.email);await syncDeviceStatusesAndLocations();
      return Response.json({ok:true,...result});
    }
    throw new AppError(400,"不支援的操作。");
  }catch(e){return failure(e);}
}
