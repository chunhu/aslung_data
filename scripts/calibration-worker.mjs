import {getConnection} from '../lib/store.mjs';
import {claimProcessing,runProcessing,scheduleProcessing} from '../lib/processing-jobs.mjs';
import {processingPool,rawProcessingRows,discoverProcessingData} from '../lib/processing-raw.mjs';
import {scheduleGlobalProcessing} from '../lib/global-processing.mjs';
import {syncCalibrationSource,ensureCalibrationSchema} from '../lib/calibration.mjs';
import {fetchCalibrationCsv} from '../lib/calibration-google.mjs';
import {uploadNextProcessingResult} from '../lib/processing-storage.mjs';
import {storageConfiguration} from '../lib/s3-storage.mjs';
import {runNextCleanup} from '../lib/processing-cleanup.mjs';
import {runHoboSync} from '../lib/hobo.mjs';
import {archiveNextHoboDay,hoboStorageConfiguration} from '../lib/hobo-storage.mjs';
import {runHoboCleanup} from '../lib/hobo-cleanup.mjs';

const d=getConnection(),pool=processingPool();let stopping=false;
storageConfiguration();hoboStorageConfiguration();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
const once=process.argv.includes('--once');
console.log('[Processing] worker ready; one job at a time. Waiting for queued jobs.');
try{
  do{
    try{
      await runHoboCleanup(d);
      await archiveNextHoboDay(d);await archiveNextHoboDay(d);
      await runHoboSync(d);
    }catch{console.error('[HOBO] storage/sync check failed; retaining staged data for retry.');}
    const cleaned=await runNextCleanup(d);
    if(cleaned)console.log('[Cleanup]',cleaned.id,cleaned.status,cleaned.error||'');
    // Refresh coefficients before scheduling new daily jobs. Never replace a failed source snapshot.
    ensureCalibrationSchema(d);
    const sources=d.prepare('SELECT id FROM calibration_sources WHERE enabled=1 AND next_check<=? AND lease_until<=?').all(new Date().toISOString(),Date.now());
    for(const source of sources){if(stopping)break;await syncCalibrationSource(d,source.id,'processing-worker',fetchCalibrationCsv);}
    scheduleProcessing(d);
    await scheduleGlobalProcessing(d,(devices,start,end,heartbeat)=>discoverProcessingData(pool,devices,start,end,heartbeat));
    const uploaded=await uploadNextProcessingResult(d);
    if(uploaded)console.log('[Storage]',uploaded.jobId,uploaded.status,uploaded.error||'');
    const job=claimProcessing(d);
    if(job){
      console.log('[Processing] started',job.id,job.device,job.start,job.end);
      try{const count=await runProcessing(d,job,rawProcessingRows(pool,job));console.log('[Processing] completed',job.id,count);}
      catch{console.error('[Processing] failed',job.id,'請至校正管理查看工作錯誤。');}
    }else if(!once&&!stopping)await new Promise(r=>setTimeout(r,5000));
  }while(!once&&!stopping);
}finally{await pool.end();d.close();}
