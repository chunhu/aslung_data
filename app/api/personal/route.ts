import {identity,writeGuard,fail,AppError} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {CalibrationError} from '@/lib/calibration.mjs';
import {fetchCalibrationCsv} from '@/lib/calibration-google.mjs';
import {personalState,requestDevice,reviewDevice,deleteDeviceClaim,manageOwnership,savePersonalSource,personalSourceAction,previewPersonalCsv,importPersonalCsv,personalRecords,personalRecordsCsv,mutatePersonalRecords,syncPersonalSource} from '@/lib/personal-calibration.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function failure(e:unknown){return e instanceof CalibrationError?Response.json({error:e.message},{status:e.status,headers:{'Cache-Control':'no-store'}}):fail(e);}
export async function GET(req:Request){try{
  const me=await identity(req),d=getConnection(),q=new URL(req.url).searchParams;
  if(q.get('source')){
    const result=personalRecords(d,me,q.get('source'),q.get('version'));
    if(q.get('download')==='1')return new Response('\uFEFF'+personalRecordsCsv(result.records),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="personal-calibration-'+result.version+'.csv"','Cache-Control':'no-store'}});
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }
  return Response.json(personalState(d,me),{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  writeGuard(req);const me=await identity(req),body=await req.text();if(Buffer.byteLength(body)>2500000)throw new AppError(413,'表單不可超過 2.5 MB。');
  let p;try{p=JSON.parse(body);}catch{throw new AppError(400,'表單格式不正確。');}
  if(!p||typeof p!=='object'||Array.isArray(p))throw new AppError(400,'表單格式不正確。');
  const d=getConnection();let result;
  switch(p.action){
    case 'claim':result=requestDevice(d,me,p);break;
    case 'review':result=reviewDevice(d,me,p);break;
    case 'claimDelete':result=deleteDeviceClaim(d,me,p);break;
    case 'revoke':case 'calibrationPermission':case 'ownershipDelete':result=manageOwnership(d,me,p);break;
    case 'sourceSave':result=savePersonalSource(d,me,p);break;
    case 'sourceDelete':case 'sourceSettings':result=personalSourceAction(d,me,p);break;
    case 'preview':{const preview=previewPersonalCsv(d,me,p.csv);result={count:preview.count,records:preview.records.slice(0,100)};break;}
    case 'import':result=importPersonalCsv(d,me,p);break;
    case 'records':result=mutatePersonalRecords(d,me,p);break;
    case 'sync':result=await syncPersonalSource(d,me,p.id,fetchCalibrationCsv);break;
    default:throw new AppError(400,'不支援的操作。');
  }
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}}
