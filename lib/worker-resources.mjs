import {setTimeout as delay} from 'node:timers/promises';

export function workerResourceOptions(env=process.env){
  const integer=(name,fallback,min,max)=>{
    const value=env[name]===undefined||env[name]===''?fallback:Number(env[name]);
    if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} 必須是 ${min} 至 ${max} 的整數。`);
    return value;
  };
  return {
    busyDelayMs:integer('WORKER_BUSY_DELAY_MS',2000,100,60000),
    idleDelayMs:integer('WORKER_IDLE_DELAY_MS',5000,1000,300000),
    archiveDays:integer('WORKER_HOBO_ARCHIVE_DAYS',1,1,10),
    calibrationSources:integer('WORKER_CALIBRATION_SOURCES',1,1,10),
    batchSize:integer('WORKER_RAW_BATCH_SIZE',1000,100,2000),
    batchPauseMs:integer('WORKER_BATCH_PAUSE_MS',50,0,1000),
  };
}

// Yield between rounds even while the processing queue is continuously busy.
// A shutdown signal interrupts the wait without abandoning a claimed job.
export async function waitForWorker(ms,signal){
  if(signal?.aborted)return;
  try{await delay(ms,undefined,{signal});}catch(e){if(e.name!=='AbortError')throw e;}
}

export async function workerCycle(tasks,options,stopping=()=>false){
  try{
    if(stopping())return false;
    await tasks.cleanupHobo();
    for(let n=0;n<options.archiveDays&&!stopping();n++)if(!await tasks.archiveHobo())break;
    if(stopping())return false;
    await tasks.syncHobo();
  }catch(e){tasks.hoboError(e);}
  for(const task of [tasks.cleanupProcessing,()=>tasks.syncSources(options.calibrationSources),tasks.schedule,tasks.upload]){
    if(stopping())return false;
    await task();
  }
  if(stopping())return false;
  return Boolean(await tasks.processNext());
}

export async function workerLoop(tasks,options,{once=false,signal,wait=waitForWorker}={}){
  const stopping=()=>Boolean(signal?.aborted);
  while(!stopping()){
    const busy=await workerCycle(tasks,options,stopping);
    if(once||stopping())return;
    await wait(busy?options.busyDelayMs:options.idleDelayMs,signal);
  }
}
