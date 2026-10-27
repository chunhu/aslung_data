import {createHash,randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {PutObjectCommand,HeadObjectCommand,GetObjectCommand,GetBucketVersioningCommand,ListObjectVersionsCommand,DeleteObjectsCommand} from '@aws-sdk/client-s3';
import {s3Client,storageConfiguration} from './s3-storage.mjs';
import {HoboError,HOBO_COLUMNS,ensureHoboSchema,hoboStatus,hoboSerial,hoboRange,hoboDeleting,hoboRevision,withHoboLock} from './hobo.mjs';

export function hoboStorageConfiguration(env=process.env){return storageConfiguration({...env,CALIBRATION_STORAGE:env.HOBO_STORAGE||'local'});}
export function hoboDay(timestamp){return new Date(Date.parse(timestamp)+28800000).toISOString().slice(0,10);}
export function hoboDayRange(day){
  if(typeof day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw new HoboError(400,'日期格式不正確。');
  const start=new Date(Date.parse(day+'T00:00:00+08:00')).toISOString();
  return {start,end:new Date(Date.parse(start)+86400000).toISOString()};
}
export function hoboPrefix(serial,day){hoboSerial(serial);hoboDayRange(day);return `hobo/${serial}/${day.replaceAll('-','/')}/`;}
function digest(buffer){return createHash('sha256').update(buffer).digest('hex');}
function identity(row){return JSON.stringify([row.logger_sn,row.timestamp,row.sensor_sn,row.data_type_id,row.sensor_measurement_type,row.unit]);}
function mergeRows(...groups){const map=new Map();for(const rows of groups)for(const row of rows)map.set(identity(row),row);return [...map.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)||identity(a).localeCompare(identity(b)));}
function awsError(e){
  if(e instanceof HoboError)return e;
  return new HoboError(502,e?.name==='AccessDenied'||e?.$metadata?.httpStatusCode===403?'HOBO S3 權限不足；讀寫使用 aslung-hobo-s3-access，清除另需 scripts/iam-hobo-cleanup.json。':'HOBO S3 操作失敗，保留本機資料與索引供重試。');
}
function cacheArchiveBounds(d,archive,rows){
  const earliest=rows.reduce((first,row)=>!first||row.timestamp<first?row.timestamp:first,'');
  if(!earliest)return null;
  const result=d.prepare(`INSERT INTO hobo_archive_bounds(serial,day,archive_key,earliest)
    SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM hobo_archives WHERE serial=? AND day=? AND key=?)
    ON CONFLICT(serial,day) DO UPDATE SET archive_key=excluded.archive_key,earliest=excluded.earliest`)
    .run(archive.serial,archive.day,archive.key,earliest,archive.serial,archive.day,archive.key);
  return result.changes?earliest:null;
}

// All counts are local/index metadata. For legacy archives, read only the
// earliest device-day once, then cache its exact bound against the immutable key.
export async function hoboDeviceOverview(d,{clientFor=s3Client}={}){
  ensureHoboSchema(d);let snapshots;
  d.exec('BEGIN');
  try{
    snapshots=hoboStatus(d).loggers.map(logger=>({
      logger,revision:d.prepare('SELECT revision FROM hobo_revisions WHERE serial=?').get(logger.serial)?.revision||0,
      localFirst:d.prepare('SELECT MIN(timestamp) first FROM hobo_observations WHERE logger_sn=?').get(logger.serial).first,
      archive:d.prepare(`SELECT a.*,b.earliest FROM hobo_archives a LEFT JOIN hobo_archive_bounds b
        ON b.serial=a.serial AND b.day=a.day AND b.archive_key=a.key WHERE a.serial=? AND a.count>0 ORDER BY a.day LIMIT 1`).get(logger.serial),
    }));
    d.exec('COMMIT');
  }catch(e){d.exec('ROLLBACK');throw e;}
  const loggers=[];
  for(const {logger,revision,localFirst,archive} of snapshots){
    let first=localFirst||null,first_error='';
    try{
      if(hoboDeleting(d,logger.serial))throw new HoboError(409,'此設備正在清除資料，完成後請更新摘要。');
      if(archive&&(!first||hoboDay(first)>=archive.day)){
        let earliest=archive.earliest;
        if(!earliest){
          const rows=await readHoboArchive(archive,clientFor(archive.region));
          if(hoboDeleting(d,logger.serial)||(d.prepare('SELECT revision FROM hobo_revisions WHERE serial=?').get(logger.serial)?.revision||0)!==revision)
            throw new HoboError(409,'設備資料已更新，請重新整理摘要。');
          earliest=cacheArchiveBounds(d,archive,rows);
          if(!earliest)throw new HoboError(409,'設備歸檔已更新，請重新整理摘要。');
        }
        if(!first||earliest<first)first=earliest;
      }
      if((d.prepare('SELECT revision FROM hobo_revisions WHERE serial=?').get(logger.serial)?.revision||0)!==revision)
        throw new HoboError(409,'設備資料已更新，請重新整理摘要。');
    }catch(e){first=null;first_error=e instanceof HoboError?e.message:'無法讀取第一筆時間，請稍後重試。';}
    loggers.push({...logger,latest:logger.latest||null,first,first_error});
  }
  return {loggers,generated_at:new Date().toISOString()};
}
export async function readHoboArchive(archive,client=s3Client(archive.region)){
  if(!archive.key.startsWith(hoboPrefix(archive.serial,archive.day))||!new RegExp(`^[0-9a-f-]{36}/${archive.sha256}\\.jsonl\\.gz$`).test(archive.key.slice(hoboPrefix(archive.serial,archive.day).length)))throw new HoboError(500,'HOBO 檔案索引路徑不正確。');
  try{
    const result=await client.send(new GetObjectCommand({Bucket:archive.bucket,Key:archive.key}));
    let bytes=0;const chunks=[];
    for await(const chunk of result.Body){bytes+=chunk.length;if(bytes>archive.bytes||bytes>64*1024**2)throw new HoboError(502,'HOBO S3 檔案過大或大小不符。');chunks.push(chunk);}
    const buffer=Buffer.concat(chunks);
    if(bytes!==archive.bytes||digest(buffer)!==archive.sha256)throw new HoboError(502,'HOBO S3 檔案檢查碼不符。');
    const text=gunzipSync(buffer,{maxOutputLength:128*1024**2}).toString('utf8');
    const rows=text.trim()?text.trim().split('\n').map(line=>JSON.parse(line)):[];
    if(rows.length!==archive.count||rows.some(row=>row.logger_sn!==archive.serial||hoboDay(row.timestamp)!==archive.day))throw new HoboError(502,'HOBO S3 資料內容不符。');
    return rows;
  }catch(e){throw awsError(e);}
}
export async function archiveNextHoboDay(d,{configuration=hoboStorageConfiguration(),clientFor=s3Client}={}){
  ensureHoboSchema(d);if(configuration.mode!=='s3')return null;
  try{return await withHoboLock(d,async heartbeat=>{
    const first=d.prepare(`SELECT logger_sn,timestamp FROM hobo_observations o WHERE NOT EXISTS
      (SELECT 1 FROM hobo_cleanup_items c WHERE c.serial=o.logger_sn AND c.status!='DONE') ORDER BY timestamp LIMIT 1`).get();
    if(!first)return null;
    const serial=first.logger_sn,day=hoboDay(first.timestamp),range=hoboDayRange(day);
    const local=d.prepare('SELECT rowid AS row_id,* FROM hobo_observations WHERE logger_sn=? AND timestamp>=? AND timestamp<?').all(serial,range.start,range.end);
    const previous=d.prepare('SELECT * FROM hobo_archives WHERE serial=? AND day=?').get(serial,day);
    const old=previous?await readHoboArchive(previous,clientFor(previous.region)):[];heartbeat();
    const rows=mergeRows(old,local.map(({row_id,...row})=>row));
    // A replay may stage rows that are already in the verified daily archive.
    // Compare observation fields, not JSON property order or compressed bytes.
    const sortedOld=mergeRows(old);
    const unchanged=previous&&previous.bucket===configuration.bucket&&previous.region===configuration.region&&
      old.length===rows.length&&sortedOld.length===rows.length&&
      sortedOld.every((row,index)=>HOBO_COLUMNS.every(key=>row[key]===rows[index][key]));
    if(unchanged){
      d.exec('BEGIN IMMEDIATE');
      try{
        if(hoboDeleting(d,serial))throw new HoboError(409,'HOBO 資料正在清除。');
        cacheArchiveBounds(d,previous,rows);
        const remove=d.prepare('DELETE FROM hobo_observations WHERE rowid=?');
        for(const row of local)remove.run(row.row_id);
        hoboRevision(d,serial);d.exec('COMMIT');
      }catch(e){d.exec('ROLLBACK');throw e;}
      d.prepare("DELETE FROM hobo_service_state WHERE name='storage_error'").run();
      return {serial,day,count:rows.length,unchanged:true};
    }
    const buffer=gzipSync(rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    if(buffer.length>64*1024**2)throw new HoboError(502,'單日 HOBO 壓縮資料超過 64 MiB，保留本機資料。');
    const sha256=digest(buffer),key=hoboPrefix(serial,day)+randomUUID()+'/'+sha256+'.jsonl.gz';
    const {bucket,region}=configuration,client=clientFor(region);
    // Record upload intent before the network request so cleanup can find orphaned uploads after a crash.
    d.prepare('INSERT OR IGNORE INTO hobo_archive_scopes(serial,day,bucket,region) VALUES(?,?,?,?)').run(serial,day,bucket,region);
    hoboRevision(d,serial);
    try{
      const checksum=Buffer.from(sha256,'hex').toString('base64');
      await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:buffer,ContentType:'application/gzip',ContentLength:buffer.length,ServerSideEncryption:'AES256',ChecksumSHA256:checksum,Metadata:{sha256}}));heartbeat();
      const head=await client.send(new HeadObjectCommand({Bucket:bucket,Key:key,ChecksumMode:'ENABLED'}));heartbeat();
      if(head.ContentLength!==buffer.length||head.ChecksumSHA256!==checksum||head.Metadata?.sha256!==sha256)throw new HoboError(502,'HOBO S3 上傳驗證失敗，保留本機資料。');
      d.exec('BEGIN IMMEDIATE');
      try{
        if(hoboDeleting(d,serial))throw new HoboError(409,'HOBO 資料正在清除。');
        d.prepare(`INSERT INTO hobo_archives(serial,day,bucket,region,key,sha256,bytes,count,latest) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(serial,day)
          DO UPDATE SET bucket=excluded.bucket,region=excluded.region,key=excluded.key,sha256=excluded.sha256,bytes=excluded.bytes,count=excluded.count,latest=excluded.latest`).run(serial,day,bucket,region,key,sha256,buffer.length,rows.length,rows.at(-1).timestamp);
        cacheArchiveBounds(d,{serial,day,key},rows);
        const remove=d.prepare('DELETE FROM hobo_observations WHERE rowid=?');for(const row of local)remove.run(row.row_id);
        hoboRevision(d,serial);d.exec('COMMIT');
      }catch(e){d.exec('ROLLBACK');throw e;}
      d.prepare("DELETE FROM hobo_service_state WHERE name='storage_error'").run();
      return {serial,day,count:rows.length};
    }catch(e){throw awsError(e);}
  });}catch(e){
    const error=awsError(e);d.prepare("INSERT INTO hobo_service_state(name,value) VALUES('storage_error',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(error.message);
    throw error;
  }
}

export async function* storedHoboRows(d,range,{clientFor=s3Client}={}){
  ensureHoboSchema(d);const serial=hoboSerial(range.serial),{start,end}=hoboRange(range.start,range.end);
  const filter=key=>{
    const value=range[key]??'';
    if(typeof value!=='string'||value.length>160)throw new HoboError(400,'搜尋條件不得超過 160 字。');
    return value.trim().toLowerCase();
  };
  const measurement=filter('measurement'),sensor=filter('sensor'),q=filter('q');
  const first=hoboDay(start),last=hoboDay(end);
  const days=d.prepare(`SELECT day FROM hobo_archives WHERE serial=? AND day>=? AND day<=? UNION
    SELECT substr(datetime(timestamp,'+8 hours'),1,10) AS day FROM hobo_observations WHERE logger_sn=? AND timestamp>=? AND timestamp<=? ORDER BY day`).all(serial,first,last,serial,start,end);
  for(const {day} of days){
    const revision=d.prepare('SELECT revision FROM hobo_revisions WHERE serial=?').get(serial)?.revision||0;
    const assertReadable=()=>{
      if(d.prepare("SELECT 1 FROM hobo_cleanup_items WHERE serial=? AND day=? AND status!='DONE'").get(serial,day))throw new HoboError(410,'此日期資料正在清除，請於完成後重新查詢。');
      if((d.prepare('SELECT revision FROM hobo_revisions WHERE serial=?').get(serial)?.revision||0)!==revision)throw new HoboError(409,'HOBO 資料已更新或清除，請重新查詢。');
    };
    assertReadable();const period=hoboDayRange(day);
    const archive=d.prepare('SELECT * FROM hobo_archives WHERE serial=? AND day=?').get(serial,day);
    const remote=archive?await readHoboArchive(archive,clientFor(archive.region)):[];
    assertReadable();
    // Read staged corrections after the remote fetch, so the newer local values take precedence.
    const local=d.prepare('SELECT * FROM hobo_observations WHERE logger_sn=? AND timestamp>=? AND timestamp<?').all(serial,period.start,period.end);
    for(const row of mergeRows(remote,local))if(row.timestamp>=start&&row.timestamp<=end){
      if(measurement&&!String(row.sensor_measurement_type).toLowerCase().includes(measurement))continue;
      if(sensor&&!String(row.sensor_sn).toLowerCase().includes(sensor))continue;
      if(q&&!HOBO_COLUMNS.some(key=>String(row[key]??'').toLowerCase().includes(q)))continue;
      assertReadable();yield row;
    }
  }
}
export async function queryStoredHobo(d,range,options={}){
  const after=range.after??0;if(!Number.isSafeInteger(after)||after<0)throw new HoboError(400,'分頁參數不正確。');
  const limit=200,rows=[];let offset=0;
  for await(const row of storedHoboRows(d,range,options)){
    if(offset++<after)continue;if(rows.length===limit)return {rows,next:after+rows.length};rows.push(row);
  }
  return {rows,next:null};
}
export async function storedHoboCsvStream(d,range,options={}){
  const iterator=storedHoboRows(d,range,options),encoder=new TextEncoder();
  let prefetched=await iterator.next(),header=true;
  const cell=value=>typeof value==='number'?String(value):'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  return new ReadableStream({async pull(controller){try{
    if(header){header=false;controller.enqueue(encoder.encode('\uFEFF'+HOBO_COLUMNS.join(',')+'\r\n'));return;}
    let chunk='';for(let n=0;n<200;n++){
      if(prefetched.done){if(chunk)controller.enqueue(encoder.encode(chunk));controller.close();return;}
      chunk+=HOBO_COLUMNS.map(key=>cell(prefetched.value[key])).join(',')+'\r\n';prefetched=await iterator.next();
    }controller.enqueue(encoder.encode(chunk));
  }catch(e){controller.error(e);await iterator.return?.();}},async cancel(){await iterator.return?.();}});
}

export async function hoboObjectVersions(scope,client=s3Client(scope.region),heartbeat=()=>{}){
  const prefix=hoboPrefix(scope.serial,scope.day);
  if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(scope.bucket))throw new HoboError(400,'HOBO S3 儲存桶不正確。');
  try{
    heartbeat();const versioning=await client.send(new GetBucketVersioningCommand({Bucket:scope.bucket}));
    const versioned=['Enabled','Suspended'].includes(versioning.Status),objects=[];let KeyMarker,VersionIdMarker;
    for(let page=0;page<100;page++){
      heartbeat();const result=await client.send(new ListObjectVersionsCommand({Bucket:scope.bucket,Prefix:prefix,KeyMarker,VersionIdMarker,MaxKeys:1000}));
      for(const item of [...(result.Versions||[]),...(result.DeleteMarkers||[])]){
        if(!item.Key?.startsWith(prefix)||!/^[0-9a-f-]{36}\/[a-f0-9]{64}\.jsonl\.gz$/.test(item.Key.slice(prefix.length))||(versioned&&typeof item.VersionId!=='string'))throw new HoboError(502,'S3 回傳範圍外物件或無效版本，停止 HOBO 清除。');
        objects.push({Key:item.Key,...(versioned?{VersionId:item.VersionId}:{}),bytes:Number(item.Size||0)});
      }
      if(!result.IsTruncated)return objects;
      if(!result.NextKeyMarker||(KeyMarker===result.NextKeyMarker&&VersionIdMarker===result.NextVersionIdMarker))throw new HoboError(502,'HOBO S3 版本分頁未前進。');
      KeyMarker=result.NextKeyMarker;VersionIdMarker=result.NextVersionIdMarker;
    }
    throw new HoboError(502,'單日 S3 版本超過清除上限。');
  }catch(e){throw awsError(e);}
}
export async function purgeHoboScope(scope,client=s3Client(scope.region),heartbeat=()=>{}){
  try{
    const versions=await hoboObjectVersions(scope,client,heartbeat);
    for(let i=0;i<versions.length;i+=1000){
      heartbeat();const result=await client.send(new DeleteObjectsCommand({Bucket:scope.bucket,Delete:{Quiet:true,Objects:versions.slice(i,i+1000).map(({bytes,...item})=>item)}}));
      if(result.Errors?.length)throw new HoboError(502,'HOBO S3 部分刪除失敗，保留索引供重試。');
    }
    if((await hoboObjectVersions(scope,client,heartbeat)).length)throw new HoboError(502,'HOBO S3 尚有版本或刪除標記，保留索引供重試。');
  }catch(e){throw awsError(e);}
}
