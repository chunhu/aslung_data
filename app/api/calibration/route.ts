import {canManageCalibration} from '@/lib/permissions.mjs';
import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {CalibrationError,ensureCalibrationSchema,saveCalibrationSource,setCalibrationSourceEnabled,syncCalibrationSource} from '@/lib/calibration.mjs';
import {fetchCalibrationCsv,calibrationAuthentication} from '@/lib/calibration-google.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
function failure(e:unknown){return e instanceof CalibrationError?Response.json({error:e.message},{status:e.status,headers:{'Cache-Control':'no-store'}}):fail(e);}
export async function GET(req:Request){try{
  const me=await identity(req);if(!canManageCalibration(me))throw new AppError(403,'只有系統管理員或校正管理員可以查詢全部設備校正參數。');
  const d=getConnection();ensureCalibrationSchema(d);const q=new URL(req.url).searchParams;
  const device=(q.get('device')||'').trim(),source=q.get('source')||'',version=q.get('version')||'';
  if(device.length>80||source.length>80||version&&!/^\d+$/.test(version))throw new AppError(400,'查詢參數不正確。');
  const offset=Number(q.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)throw new AppError(400,'分頁不正確。');
  const clauses=['1=1'],args:(string|number)[]=[];
  if(device){clauses.push('r.aslung_id=?');args.push(device);}
  if(source){clauses.push('s.id=?');args.push(source);}
  if(version){clauses.push('r.version_id=?');args.push(Number(version));}
  else clauses.push('r.version_id=s.current_version');
  const join='FROM calibration_records r JOIN calibration_versions v ON v.id=r.version_id JOIN calibration_sources s ON s.id=v.source_id WHERE '+clauses.join(' AND ');
  const records=d.prepare('SELECT r.*,s.name AS source_name,s.enabled AS source_enabled,v.created_at AS synced_at '+join+' ORDER BY r.aslung_id,r.channel,r.start DESC LIMIT 200 OFFSET ?').all(...args,offset);
  const total=d.prepare('SELECT COUNT(*) AS n '+join).get(...args)?.n||0;
  return Response.json({sources:d.prepare('SELECT id,name,url,description,enabled,current_version,last_check,last_success,last_status,last_error,next_check,config_revision FROM calibration_sources ORDER BY name').all(),
    records,total,offset,hasMore:offset+records.length<Number(total),authentication:calibrationAuthentication(),
    versions:d.prepare('SELECT * FROM calibration_versions WHERE (?=\'\' OR source_id=?) ORDER BY id DESC LIMIT 200').all(source,source),
    logs:d.prepare('SELECT l.*,s.name AS source_name FROM calibration_sync_logs l JOIN calibration_sources s ON s.id=l.source_id WHERE (?=\'\' OR l.source_id=?) ORDER BY l.id DESC LIMIT 50').all(source,source),
    devices:d.prepare('SELECT DISTINCT r.aslung_id FROM calibration_records r JOIN calibration_sources s ON s.current_version=r.version_id ORDER BY r.aslung_id LIMIT 10000').all().map((r:any)=>r.aslung_id)
  },{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  writeGuard(req);const me=await identity(req);if(!canManageCalibration(me))throw new AppError(403,'只有系統管理員或校正管理員可以管理校正來源。');
  const p=await req.json();if(!p||typeof p!=='object'||Array.isArray(p))throw new AppError(400,'表單內容不正確。');
  const d=getConnection();ensureCalibrationSchema(d);
  if(p.action==='save')return Response.json({ok:true,id:saveCalibrationSource(d,p,me.email)});
  if(typeof p.id!=='string'||!d.prepare('SELECT id FROM calibration_sources WHERE id=?').get(p.id))throw new AppError(404,'來源不存在。');
  if(p.action==='enabled'){setCalibrationSourceEnabled(d,p.id,p.enabled,me.email);return Response.json({ok:true});}
  if(p.action==='sync')return Response.json(await syncCalibrationSource(d,p.id,me.email,fetchCalibrationCsv,{force:true}));
  throw new AppError(400,'不支援的操作。');
}catch(e){return failure(e);}}
