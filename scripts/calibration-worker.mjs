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

import {workerResourceOptions,workerLoop} from '../lib/worker-resources.mjs';

// Reject invalid pacing before opening SQLite or creating a connection pool.
const options=workerResourceOptions();
storageConfiguration();hoboStorageConfiguration();
const d=getConnection(),pool=processingPool(),shutdown=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>shutdown.abort());
const once=process.argv.includes('--once');
console.log('[Processing] worker ready; one job at a time.',JSON.stringify(options));
try{
  await workerLoop({
    cleanupHobo:()=>runHoboCleanup(d),
    archiveHobo:()=>archiveNextHoboDay(d),
    syncHobo:()=>runHoboSync(d),
    hoboError:()=>console.error('[HOBO] storage/sync check failed; retaining staged data for retry.'),
    cleanupProcessing:async()=>{
      const cleaned=await runNextCleanup(d);
      if(cleaned)console.log('[Cleanup]',cleaned.id,cleaned.status,cleaned.error||'');
    },
    syncSources:async limit=>{
      // Bound each round and serve the oldest due source first.
      ensureCalibrationSchema(d);
      const sources=d.prepare('SELECT id FROM calibration_sources WHERE enabled=1 AND next_check<=? AND lease_until<=? ORDER BY next_check,id LIMIT ?').all(new Date().toISOString(),Date.now(),limit);
      for(const source of sources){if(shutdown.signal.aborted)break;await syncCalibrationSource(d,source.id,'processing-worker',fetchCalibrationCsv);}
    },
    schedule:async()=>{
      scheduleProcessing(d);
      await scheduleGlobalProcessing(d,(devices,start,end,heartbeat)=>discoverProcessingData(pool,devices,start,end,heartbeat,{batchPauseMs:options.batchPauseMs}));
    },
    upload:async()=>{
      const uploaded=await uploadNextProcessingResult(d);
      if(uploaded)console.log('[Storage]',uploaded.jobId,uploaded.status,uploaded.error||'');
    },
    processNext:async()=>{
      const job=claimProcessing(d);if(!job)return false;
      console.log('[Processing] started',job.id,job.device,job.start,job.end);
      try{const count=await runProcessing(d,job,rawProcessingRows(pool,job,{batchSize:options.batchSize,batchPauseMs:options.batchPauseMs}));console.log('[Processing] completed',job.id,count);}
      catch{console.error('[Processing] failed',job.id,'請至校正管理查看工作錯誤。');}
      return true;
    },
  },options,{once,signal:shutdown.signal});
}finally{try{await pool.end();}finally{d.close();}}
