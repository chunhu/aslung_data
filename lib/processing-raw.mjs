import {setTimeout as delay} from 'node:timers/promises';
import mysql from 'mysql2/promise';
import {mysqlOptions} from './mysql-options.mjs';
const projection=`rawdata.*,uid AS aslung_id,ch1 AS PM1_G3,ch2 AS \`PM2.5_G3\`,ch3 AS PM10_G3,
  ch4 AS temperature,ch5 AS rh,ch6 AS co2,ch7 AS battery,
  ch8 AS acc_x,ch9 AS acc_y,ch10 AS acc_z,ch11 AS gps,ch12 AS gps_speed,ch13 AS gps_direction,ch14 AS gps_height,
  ch21 AS air_pressure,ch22 AS noise1,ch23 AS noise2,ch24 AS noise3,
  ch29 AS PM1_GSA,ch30 AS \`PM2.5_GSA\`,ch31 AS PM10_GSA,
  ch32 AS \`Num_0.3_GSA\`,ch33 AS \`Num_0.5_GSA\`,ch34 AS \`Num_1.0_GSA\`,
  ch35 AS \`Num_2.5_GSA\`,ch36 AS \`Num_5.0_GSA\`,ch37 AS \`Num_10_GSA\``;
export function processingPool(){
  return mysql.createPool(mysqlOptions('worker'));
}
export async function discoverProcessingData(pool,devices,start,end,heartbeat=()=>{},{batchPauseMs=0}={}){
  const result=[];
  for(let offset=0;offset<devices.length;offset+=100){
    heartbeat();const batch=devices.slice(offset,offset+100);
    const [rows]=await pool.query({sql:`SELECT uid AS device,DATE_FORMAT(DATE_ADD(time,INTERVAL 8 HOUR),'%Y-%m-%d') AS day,
      COUNT(*) AS sample_count,CAST(MAX(id) AS CHAR) AS last_id FROM rawdata
      WHERE uid IN (${batch.map(()=>'?').join(',')}) AND time>=? AND time<? GROUP BY uid,day`,
      values:[...batch,sqlTime(start),sqlTime(end)],timeout:60000});
    result.push(...rows);heartbeat();
    if(batchPauseMs>0&&offset+100<devices.length)await delay(batchPauseMs);
  }
  return result;
}
const sqlTime=value=>new Date(value).toISOString().slice(0,23).replace('T',' ');
function normalized(row){const {time,...values}=row;return {...values,timestamp:(time instanceof Date?time:new Date(time+'Z')).toISOString()};}
export async function* rawProcessingRows(pool,job,{batchSize=2000,batchPauseMs=0}={}){
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>2000||!Number.isInteger(batchPauseMs)||batchPauseMs<0||batchPauseMs>1000)throw new Error('Worker batch options are invalid.');
  const start=sqlTime(job.start),end=sqlTime(job.end);
  // Parameterized keyset pagination, with 25 real samples on either side of the requested interval.
  const [before]=await pool.query({sql:`SELECT ${projection} FROM rawdata WHERE uid=? AND time<? ORDER BY time DESC,id DESC LIMIT 25`,values:[job.device,start],timeout:60000});
  for(const row of before.reverse())yield normalized(row);
  let cursor=null;
  while(true){
    const values=[job.device,start,end];
    let condition='';if(cursor){condition=' AND (time>? OR (time=? AND id>?))';values.push(cursor.time,cursor.time,cursor.id);}
    const [rows]=await pool.query({sql:`SELECT ${projection} FROM rawdata WHERE uid=? AND time>=? AND time<?${condition} ORDER BY time,id LIMIT ${batchSize}`,values,timeout:60000});
    for(const row of rows)yield normalized(row);
    if(rows.length<batchSize)break;cursor=rows.at(-1);
    if(batchPauseMs>0)await delay(batchPauseMs);
  }
  const [after]=await pool.query({sql:`SELECT ${projection} FROM rawdata WHERE uid=? AND time>=? ORDER BY time,id LIMIT 25`,values:[job.device,end],timeout:60000});
  for(const row of after)yield normalized(row);
}
