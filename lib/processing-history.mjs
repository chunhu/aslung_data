import {randomUUID} from 'node:crypto';
import {ensureProcessingSchema,enqueueProcessing} from './processing-jobs.mjs';
import {currentCalibrationRecords} from './calibration.mjs';
import {processingRecipe} from './measurement-processing.mjs';
import {storageConfiguration} from './s3-storage.mjs';
const error=(status,message)=>Object.assign(new Error(message),{status});
function day(value){const time=Date.parse(value+'T00:00:00+08:00');if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(time)||new Date(time+28800000).toISOString().slice(0,10)!==value)throw error(400,'請選擇有效的臺灣日期。');return time;}
export function enqueueHistorical(d,p,actor,configuration=storageConfiguration()){
 if(configuration.mode!=='s3')throw error(409,'請先設定 CALIBRATION_STORAGE=s3、S3_BUCKET 與 AWS_REGION，並新增歷史封存權限。');
 ensureProcessingSchema(d);
 if(!Array.isArray(p.devices)||!p.devices.length||p.devices.length>500||p.devices.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(id)))throw error(400,'請指定 1 至 500 台已登錄設備。');
 const devices=[...new Set(p.devices)],start=day(p.from),end=day(p.to)+86400000;
 if(end<=start||end-start>3660*86400000)throw error(400,'歷史封存期間需為 1 至 3660 天（結束日期含當日）。');
 if(!['raw','processed','both'].includes(p.kind))throw error(400,'請選擇原始量測、校正成果或兩者。');
 if(p.kind!=='raw')processingRecipe(p.upLimit===undefined?3:p.upLimit);
 const kinds=p.kind==='both'?['raw','processed']:[p.kind],days=(end-start)/86400000;
 if(devices.length*days*kinds.length>5000)throw error(400,'單批最多 5000 個設備日工作，請縮短期間或分批設備。');
 if(p.refresh!==undefined&&typeof p.refresh!=='boolean')throw error(400,'重新抓取設定不正確。');
 const refresh=p.refresh?randomUUID():'',ids=[],skipped=[];let reused=0,rawJobs=0,processedJobs=0;
 d.exec('BEGIN IMMEDIATE');try{
  for(const device of devices){
   if(!d.prepare('SELECT id FROM devices WHERE id=?').get(device))throw error(404,`找不到設備 ${device}。`);
   const factors=kinds.includes('processed')?currentCalibrationRecords(d,device).filter(r=>!r.channel.startsWith('UNMAPPED:')&&r.channel!=='PM125'):[];
   for(let a=start;a<end;a+=86400000)for(const dataKind of kinds){
    const from=new Date(a).toISOString(),to=new Date(a+86400000).toISOString();
    if(dataKind==='processed'&&!factors.some(r=>r.start<to&&(!r.end||r.end>from))){skipped.push({device,day:new Date(a+28800000).toISOString().slice(0,10),reason:'NO_FACTOR'});continue;}
    const before=d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n;
    const id=enqueueProcessing(d,{device,start:from,end:to,dataKind,upLimit:p.upLimit,actor,refresh});ids.push(id);if(dataKind==='raw')rawJobs++;else processedJobs++;
    if(d.prepare('SELECT COUNT(*) n FROM processing_jobs').get().n===before)reused++;
   }
  }
  d.exec('COMMIT');return {ok:true,jobs:ids.length,raw_jobs:rawJobs,processed_jobs:processedJobs,created:ids.length-reused,reused,skipped:skipped.length,skipped_examples:skipped.slice(0,20)};
 }catch(e){d.exec('ROLLBACK');throw e;}
}
