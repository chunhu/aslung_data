import {identity,writeGuard,AppError,fail,syncDeviceStatusesAndLocations} from "@/lib/server";
import {getConnection} from "@/lib/store.mjs";
import {quickUpdateDevice} from "@/lib/fleet-quick-edit.mjs";
import {ensureFleetSchema,updateFleetDevices,previewFleetImport,applyFleetImport,FleetError} from "@/lib/fleet-store.mjs";

import {ensureFleetSyncSchema,fetchFleetCsv,fleetSyncState,saveFleetSchedule,updateFleetSchedule} from "@/lib/fleet-sync.mjs";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function failure(e: unknown) {
  if(e instanceof FleetError)return Response.json({error:e.message},{status:e.status});
  return fail(e);
}
export async function GET(req:Request) {
  try {
    const me=await identity(req);if(me.role!=="admin")throw new AppError(403,"只有管理員可以檢視設備歷程。");
    if(new URL(req.url).searchParams.get("sync")==="1")return Response.json(fleetSyncState(getConnection()),{headers:{"Cache-Control":"no-store"}});
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
      return Response.json({text:await fetchFleetCsv(p.url)},{headers:{"Cache-Control":"no-store"}});
    }
    if(p.action==="scheduleSettings")return Response.json(updateFleetSchedule(d,p,me.email));
    if(p.action==="previewImport")return Response.json(previewFleetImport(d,p),{headers:{"Cache-Control":"no-store"}});
    if(p.action==="applyImport"){
      if(p.schedule)ensureFleetSyncSchema(d);
      const result=applyFleetImport(d,p,me.email,p.schedule?{beforeCommit:()=>saveFleetSchedule(d,p,me.email)}:{});await syncDeviceStatusesAndLocations();
      return Response.json({ok:true,...result});
    }
    throw new AppError(400,"不支援的操作。");
  }catch(e){return failure(e);}
}
