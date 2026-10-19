import mysql from 'mysql2/promise';
const projection=`id,uid AS aslung_id,time,ch1 AS PM1_G3,ch2 AS \`PM2.5_G3\`,ch3 AS PM10_G3,
  ch4 AS temperature,ch5 AS rh,ch6 AS co2,ch29 AS PM1_GSA,ch30 AS \`PM2.5_GSA\`,ch31 AS PM10_GSA`;
export function processingPool(){
  if(!process.env.MYSQL_HOST||!process.env.MYSQL_USER||!process.env.MYSQL_DATABASE)throw new Error('背景校正需要設定 MYSQL_HOST、MYSQL_USER、MYSQL_DATABASE。');
  return mysql.createPool({host:process.env.MYSQL_HOST,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,
    database:process.env.MYSQL_DATABASE,port:Number(process.env.MYSQL_PORT||3306),timezone:'+00:00',decimalNumbers:true,
    connectionLimit:2,connectTimeout:10000,enableKeepAlive:true});
}
export async function discoverProcessingData(pool,devices,start,end,heartbeat=()=>{}){
  const result=[];
  for(let offset=0;offset<devices.length;offset+=100){
    heartbeat();const batch=devices.slice(offset,offset+100);
    const [rows]=await pool.query({sql:`SELECT uid AS device,DATE_FORMAT(DATE_ADD(time,INTERVAL 8 HOUR),'%Y-%m-%d') AS day,
      COUNT(*) AS sample_count,CAST(MAX(id) AS CHAR) AS last_id FROM rawdata
      WHERE uid IN (${batch.map(()=>'?').join(',')}) AND time>=? AND time<? GROUP BY uid,day`,
      values:[...batch,sqlTime(start),sqlTime(end)],timeout:60000});
    result.push(...rows);heartbeat();
  }
  return result;
}
const sqlTime=value=>new Date(value).toISOString().slice(0,23).replace('T',' ');
function normalized(row){const {time,...values}=row;return {...values,timestamp:(time instanceof Date?time:new Date(time+'Z')).toISOString()};}
export async function* rawProcessingRows(pool,job){
  const start=sqlTime(job.start),end=sqlTime(job.end);
  // Parameterized keyset pagination, with 25 real samples on either side of the requested interval.
  const [before]=await pool.query({sql:`SELECT ${projection} FROM rawdata WHERE uid=? AND time<? ORDER BY time DESC,id DESC LIMIT 25`,values:[job.device,start],timeout:60000});
  for(const row of before.reverse())yield normalized(row);
  let cursor=null;
  while(true){
    const values=[job.device,start,end];
    let condition='';if(cursor){condition=' AND (time>? OR (time=? AND id>?))';values.push(cursor.time,cursor.time,cursor.id);}
    const [rows]=await pool.query({sql:`SELECT ${projection} FROM rawdata WHERE uid=? AND time>=? AND time<?${condition} ORDER BY time,id LIMIT 2000`,values,timeout:60000});
    for(const row of rows)yield normalized(row);
    if(rows.length<2000)break;cursor=rows.at(-1);
  }
  const [after]=await pool.query({sql:`SELECT ${projection} FROM rawdata WHERE uid=? AND time>=? ORDER BY time,id LIMIT 25`,values:[job.device,end],timeout:60000});
  for(const row of after)yield normalized(row);
}
