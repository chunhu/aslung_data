import {createHash,randomUUID} from 'node:crypto';
import {currentCalibrationRecords} from './calibration.mjs';
import {ensureProcessingSchema,enqueueProcessing} from './processing-jobs.mjs';
import {processingRecipe,DEFAULT_UP_LIMIT} from './measurement-processing.mjs';

export function ensureGlobalProcessingSchema(d){
  ensureProcessingSchema(d);
  d.exec(`CREATE TABLE IF NOT EXISTS processing_global(
    id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,up_limit REAL NOT NULL DEFAULT 3,
    revision INTEGER NOT NULL DEFAULT 0,last_day TEXT,last_check TEXT,last_error TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '{}',owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT NOT NULL DEFAULT '',updated_at TEXT);
    INSERT OR IGNORE INTO processing_global(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS processing_global_seen(device TEXT PRIMARY KEY,last_raw_id TEXT NOT NULL,config_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS processing_global_days(device TEXT NOT NULL,day TEXT NOT NULL,last_raw_id TEXT NOT NULL,config_hash TEXT NOT NULL,PRIMARY KEY(device,day));`);
}
export function globalProcessingSettings(d){
  ensureGlobalProcessingSchema(d);
  const row=d.prepare('SELECT enabled,up_limit,last_day,last_check,last_error,summary,lease_until,updated_by,updated_at FROM processing_global WHERE id=1').get();
  return {...row,summary:JSON.parse(row.summary)};
}
export function saveGlobalProcessing(d,{enabled,upLimit=DEFAULT_UP_LIMIT,actor}){
  ensureGlobalProcessingSchema(d);processingRecipe(upLimit);
  if(typeof enabled!=='boolean')throw new Error('全域排程狀態不正確。');
  d.prepare(`UPDATE processing_global SET enabled=?,up_limit=?,revision=revision+1,last_day=NULL,retry_at=0,last_error='',updated_by=?,updated_at=? WHERE id=1`)
    .run(+enabled,upLimit,actor,new Date().toISOString());
}
export async function scheduleGlobalProcessing(d,discover,now=new Date()){
  ensureGlobalProcessingSchema(d);
  const local=new Date(now.getTime()+8*3600000);if(local.getUTCHours()<3)return;
  const day=local.toISOString().slice(0,10),owner=randomUUID();
  const settings=d.prepare(`UPDATE processing_global SET owner=?,lease_until=? WHERE id=1 AND enabled=1
    AND (last_day IS NULL OR last_day<>?) AND retry_at<=? AND lease_until<=? RETURNING *`)
    .get(owner,now.getTime()+600000,day,now.getTime(),now.getTime());
  if(!settings)return;
  const heartbeat=()=>{
    const changed=d.prepare('UPDATE processing_global SET lease_until=? WHERE id=1 AND owner=? AND revision=? AND enabled=1').run(Date.now()+600000,owner,settings.revision);
    if(!changed.changes)throw new Error('全域排程設定已變更，取消本次掃描。');
  };
  try{
    const all=currentCalibrationRecords(d).filter(r=>!r.channel.startsWith('UNMAPPED:')&&r.channel!=='PM125');
    const registered=new Set(d.prepare('SELECT id FROM devices').all().map(r=>r.id));
    const manual=new Set(d.prepare('SELECT device FROM processing_schedules WHERE enabled=1').all().map(r=>r.device));
    const candidates=[...new Set(all.map(r=>r.aslung_id))].filter(id=>registered.has(id)&&!manual.has(id));
    const midnight=Date.parse(day+'T00:00:00+08:00'),start=new Date(midnight-3*86400000).toISOString();
    // Include today's arrivals for detecting new context, but only publish completed days.
    const measurements=candidates.length?await discover(candidates,start,now.toISOString(),heartbeat):[];
    heartbeat();
    const groups=new Map();for(const item of measurements){
      if(!candidates.includes(item.device)||!/^\d{4}-\d{2}-\d{2}$/.test(item.day)||!/^\d+$/.test(String(item.last_id)))throw new Error('量測摘要格式不正確。');
      if(!groups.has(item.device))groups.set(item.device,[]);groups.get(item.device).push(item);
    }
    const summary={candidateDevices:candidates.length,devicesWithData:groups.size,changedDevices:0,jobs:0,manualDevices:manual.size};
    d.exec('BEGIN IMMEDIATE');try{
      const live=d.prepare('SELECT * FROM processing_global WHERE id=1').get();
      if(live.owner!==owner||!live.enabled||live.revision!==settings.revision)throw new Error('全域排程設定已變更，取消本次掃描。');
      for(const [device,items] of groups){
        const factors=all.filter(r=>r.aslung_id===device);
        const config=createHash('sha256').update(JSON.stringify({recipe:processingRecipe(settings.up_limit),factors})).digest('hex');
        const max=items.reduce((n,r)=>BigInt(r.last_id)>n?BigInt(r.last_id):n,0n),previous=d.prepare('SELECT * FROM processing_global_seen WHERE device=?').get(device);
        const contextChanged=!previous||max>BigInt(previous.last_raw_id)||previous.config_hash!==config;
        let changed=false;
        for(const item of items){
          const a=Date.parse(item.day+'T00:00:00+08:00'),b=a+86400000;
          if(a<midnight-3*86400000||b>midnight)continue;
          if(!factors.some(r=>Date.parse(r.start)<b&&(!r.end||Date.parse(r.end)>a)))continue;
          const processed=d.prepare('SELECT * FROM processing_global_days WHERE device=? AND day=?').get(device,item.day);
          if(!contextChanged&&processed&&BigInt(item.last_id)<=BigInt(processed.last_raw_id)&&processed.config_hash===config)continue;
          enqueueProcessing(d,{device,start:new Date(a).toISOString(),end:new Date(b).toISOString(),upLimit:settings.up_limit,actor:'global-scheduler',refresh:'global:'+max.toString()});summary.jobs++;
          changed=true;
          d.prepare(`INSERT INTO processing_global_days(device,day,last_raw_id,config_hash) VALUES(?,?,?,?)
            ON CONFLICT(device,day) DO UPDATE SET last_raw_id=excluded.last_raw_id,config_hash=excluded.config_hash`).run(device,item.day,String(item.last_id),config);
        }
        if(changed)summary.changedDevices++;
        d.prepare(`INSERT INTO processing_global_seen(device,last_raw_id,config_hash) VALUES(?,?,?)
          ON CONFLICT(device) DO UPDATE SET last_raw_id=excluded.last_raw_id,config_hash=excluded.config_hash`).run(device,(previous&&BigInt(previous.last_raw_id)>max?BigInt(previous.last_raw_id):max).toString(),config);
      }
      d.prepare("UPDATE processing_global SET last_day=?,last_check=?,last_error='',summary=?,retry_at=0 WHERE id=1 AND owner=?").run(day,now.toISOString(),JSON.stringify(summary),owner);
      d.exec('COMMIT');return summary;
    }catch(e){d.exec('ROLLBACK');throw e;}
  }catch(e){
    d.prepare('UPDATE processing_global SET last_check=?,last_error=?,retry_at=? WHERE id=1 AND owner=? AND revision=?')
      .run(now.toISOString(),String(e.message).slice(0,2000),now.getTime()+300000,owner,settings.revision);
    return {error:e.message};
  }finally{d.prepare('UPDATE processing_global SET owner=NULL,lease_until=0 WHERE id=1 AND owner=?').run(owner);}
}
