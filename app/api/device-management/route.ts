import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {canManageDevices} from '@/lib/permissions.mjs';
import {AccessError,managedDeviceIds,assertManagedDevice} from '@/lib/member-access.mjs';
import {quickUpdateDevice} from '@/lib/fleet-quick-edit.mjs';
import {FleetError,ensureFleetSchema} from '@/lib/fleet-store.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
function failure(e:unknown){return e instanceof AccessError||e instanceof FleetError?Response.json({error:e.message},{status:e.status}):fail(e);}
export async function GET(req:Request){try{
  const me=await identity(req);if(!canManageDevices(me))throw new AppError(403,'沒有設備管理權限。');
  const d=getConnection(),ids=managedDeviceIds(d,me);
  const devices=d.prepare('SELECT * FROM devices ORDER BY id').all().filter((r:any)=>ids.has(r.id));
  const locations=d.prepare('SELECT * FROM device_locations ORDER BY start_time DESC').all().filter((r:any)=>ids.has(r.aslung_id));
  ensureFleetSchema(d);
  return Response.json({devices,locations,labs:d.prepare('SELECT id,location_name,city_name,town_name FROM labs ORDER BY id').all(),maintainers:d.prepare('SELECT name,english_name FROM maintainers ORDER BY name').all(),events:d.prepare('SELECT * FROM device_events ORDER BY id DESC LIMIT 1000').all().filter((r:any)=>ids.has(r.device_id)).slice(0,100)},{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  writeGuard(req);const me=await identity(req);if(!canManageDevices(me))throw new AppError(403,'沒有設備管理權限。');
  const p=await req.json();if(!p||p.action!=='quick'||typeof p.id!=='string')throw new AppError(400,'僅支援已授權設備的快速更新。');
  const d=getConnection();assertManagedDevice(d,me,p.id);
  return Response.json({ok:true,...quickUpdateDevice(d,p,me.email,()=>assertManagedDevice(d,me,p.id))});
}catch(e){return failure(e);}}
