import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {canManageCalibration} from '@/lib/permissions.mjs';
import {getConnection} from '@/lib/store.mjs';
import {CalibrationError,listCalibrationHistory,calibrationHistoryDetail,calibrationHistoryFiles,editCalibrationHistory,deleteCalibrationHistory} from '@/lib/calibration.mjs';
import {csvChunks} from '@/lib/csv-zip.mjs';
import JSZip from 'jszip';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
function failure(e:unknown){return e instanceof CalibrationError?Response.json({error:e.message},{status:e.status,headers}):fail(e);}
async function guard(req:Request){const me=await identity(req);if(!canManageCalibration(me))throw new AppError(403,'只有系統管理員或校正管理員可以管理校正匯入紀錄。');return me;}
async function csvText(rows:Record<string,unknown>[]){let text='';for await(const chunk of csvChunks(rows))text+=chunk;return text;}
export async function GET(req:Request){try{
  await guard(req);const d=getConnection(),q=new URL(req.url).searchParams,offset=Number(q.get('offset')||0);
  if(!q.has('id'))return Response.json(listCalibrationHistory(d,{source:q.get('source')||'',offset}),{headers});
  const id=Number(q.get('id'));
  if(q.get('download')!=='1')return Response.json(calibrationHistoryDetail(d,id,offset),{headers});
  const detail=calibrationHistoryFiles(d,id),zip=new JSZip();
  zip.file('metadata.json',JSON.stringify({log:detail.log,total:detail.total,issues:detail.issues},null,2));
  zip.file('report.txt','\uFEFF'+detail.log.source_name+'\n'+detail.log.created_at+'\n'+detail.log.status+'\n'+detail.log.message+'\n\n備註：'+detail.log.note+
    (!detail.log.has_snapshot?'\n舊紀錄未保存當次來源快照，無法提供原始匯入檔或推定版本。':''));
  if(detail.csv!==null)zip.file('source.csv','\uFEFF'+detail.csv.replace(/^\uFEFF/,''));
  if(detail.issues.length)zip.file('issues.csv',await csvText(detail.issues.map((i:any)=>({rows:i.rows.join('、'),device:i.device,channel:i.channel,reason:i.reason}))));
  if(detail.log.version_id)zip.file('coefficients.csv',await csvText(detail.records));
  const buffer=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:3}});
  return new Response(new Uint8Array(buffer),{headers:{...headers,'Content-Type':'application/zip','Content-Disposition':`attachment; filename="calibration-import-${id}.zip"`}});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  writeGuard(req);const me=await guard(req),p=await req.json();
  if(!p||typeof p!=='object'||Array.isArray(p))throw new AppError(400,'表單內容不正確。');
  const d=getConnection();
  if(p.action==='note')return Response.json(editCalibrationHistory(d,p,me.email),{headers});
  if(p.action==='delete')return Response.json(deleteCalibrationHistory(d,p.ids,me.email),{headers});
  throw new AppError(400,'不支援的操作。');
}catch(e){return failure(e);}}
