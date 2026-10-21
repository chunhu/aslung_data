import {currentDeploymentMap} from './device-deployments.mjs';

export function realtimeYearCutoff(now = new Date()) {
  const cutoff=new Date(now);cutoff.setUTCFullYear(cutoff.getUTCFullYear()-1);return cutoff.getTime();
}

export function visibleRealtimeRows(readings, devices, locations, now = new Date()) {
  const deployed=new Set(currentDeploymentMap(locations,now).keys());
  for(const d of devices)if(d.status==='DEPLOYED')deployed.add(d.id);
  const cutoff=realtimeYearCutoff(now);
  return readings.filter(r=>deployed.has(r.aslung_id)||Date.parse(r.timestamp)>=cutoff);
}

export function mergeRealtimeRows(known, discovered) {
  const map=new Map();
  for(const row of [...known,...discovered]){
    const old=map.get(row.aslung_id);
    if(!old||Date.parse(row.timestamp)>Date.parse(old.timestamp))map.set(row.aslung_id,row);
  }
  return [...map.values()].sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
}

export async function discoverRealtimeDevices(pool, registeredIds, days = 7, now = new Date()) {
  if(![1,7,30,365].includes(days))throw new Error('搜尋期間只支援 1、7、30 或 365 天。');
  const limit=200,cutoff=new Date(now.getTime()-days*86400000).toISOString().slice(0,19).replace('T',' ');
  const end=now.toISOString().slice(0,19).replace('T',' ');
  const exclude=registeredIds.length?`AND uid NOT IN (${registeredIds.map(()=>'?').join(',')})`:'';
  // Explicit user-triggered, time-bounded discovery. Never scan the entire
  // measurement history automatically on every dashboard refresh.
  const [candidates]=await pool.query({sql:`SELECT /*+ MAX_EXECUTION_TIME(15000) */ DISTINCT uid AS aslung_id FROM rawdata
    WHERE time >= ? AND time <= ? ${exclude} ORDER BY uid LIMIT ?`,timeout:15000},[cutoff,end,...registeredIds,limit+1]);
  const ids=[...new Set(candidates.map(r=>String(r.aslung_id||'')))].filter(id=>/^[A-Za-z0-9_-]{1,80}$/.test(id)&&!registeredIds.includes(id));
  const devices=[],failedIds=[];
  for(let start=0;start<Math.min(ids.length,limit);start+=8){
    await Promise.all(ids.slice(start,Math.min(start+8,limit)).map(async id=>{
      try{
        const [rows]=await pool.query({sql:`SELECT time,uid AS aslung_id,ch1 AS PM1_G3,ch2 AS \`PM2.5_G3\`,ch3 AS PM10_G3,
          ch4 AS temperature,ch5 AS rh,ch6 AS co2,ch7 AS battery,ch29 AS PM1_GSA,ch30 AS \`PM2.5_GSA\`,ch31 AS PM10_GSA
          FROM rawdata WHERE uid=? AND time<=? ORDER BY time DESC LIMIT 1`,timeout:10000},[id,end]);
        if(!rows.length)return;
        const {time,...data}=rows[0];
        if(data.aslung_id!==id)throw new Error('量測資料的設備編號不符。');
        const timestamp=time instanceof Date?time:new Date(/[Zz]|[+-]\d{2}:\d{2}$/.test(String(time))?String(time):String(time).replace(' ','T')+'Z');
        if(!Number.isFinite(timestamp.getTime()))throw new Error('量測時間無效。');
        devices.push({...data,timestamp:timestamp.toISOString(),unregistered:true});
      }catch{failedIds.push(id);}
    }));
  }
  devices.sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
  return {devices,days,limit,truncated:candidates.length>limit,failedCount:failedIds.length,checkedAt:now.toISOString()};
}
