import {createHash, randomUUID} from 'node:crypto';
import {parseImportTable} from './fleet-import.mjs';
import {implicitCalibrationEnd} from './calibration-dates.mjs';
import {gzipSync,gunzipSync} from 'node:zlib';

export class CalibrationError extends Error {constructor(message,status=400,issues=[]){super(message);this.status=status;this.issues=issues;}}
export const CHANNELS={PM1:'PM1_G3','PM2.5':'PM2.5_G3',PM10:'PM10_G3',PM1_GSA:'PM1_GSA','PM2.5_GSA':'PM2.5_GSA',PM10_GSA:'PM10_GSA'};
export function ensureCalibrationSchema(d){
  d.exec(`CREATE TABLE IF NOT EXISTS calibration_sources(
    id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,config_revision INTEGER NOT NULL DEFAULT 1,
    current_version INTEGER,content_hash TEXT,last_check TEXT,last_success TEXT,last_status TEXT,last_error TEXT,
    next_check TEXT NOT NULL,lease_owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS calibration_versions(
    id INTEGER PRIMARY KEY,source_id TEXT NOT NULL REFERENCES calibration_sources(id),content_hash TEXT NOT NULL,
    name TEXT NOT NULL,url TEXT NOT NULL,record_count INTEGER NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS calibration_records(
    id INTEGER PRIMARY KEY,version_id INTEGER NOT NULL REFERENCES calibration_versions(id),aslung_id TEXT NOT NULL,
    channel TEXT NOT NULL,start TEXT NOT NULL,end TEXT,a1 REAL NOT NULL,b1 REAL NOT NULL,breakpoint REAL,
    a2 REAL,b2 REAL,row_number INTEGER NOT NULL,quality TEXT NOT NULL,
    source_start TEXT NOT NULL DEFAULT '',source_end TEXT NOT NULL DEFAULT '',boundary_note TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS calibration_device ON calibration_records(aslung_id,version_id,channel,start);
    CREATE TABLE IF NOT EXISTS calibration_sync_logs(id INTEGER PRIMARY KEY,source_id TEXT NOT NULL REFERENCES calibration_sources(id),
    status TEXT NOT NULL,message TEXT NOT NULL,record_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,actor TEXT NOT NULL);`);
  d.exec(`CREATE TABLE IF NOT EXISTS calibration_import_files(hash TEXT PRIMARY KEY,csv_gzip BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS calibration_import_details(
      log_id INTEGER PRIMARY KEY REFERENCES calibration_sync_logs(id) ON DELETE CASCADE,
      source_name TEXT NOT NULL,source_url TEXT NOT NULL,source_description TEXT NOT NULL,
      version_id INTEGER, file_hash TEXT REFERENCES calibration_import_files(hash),issues_json TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,updated_by TEXT,updated_at TEXT,captured INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS calibration_history_events(
      id INTEGER PRIMARY KEY,log_id INTEGER,source_id TEXT,action TEXT NOT NULL,actor TEXT NOT NULL,
      before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL);`);
  if(!d.prepare('PRAGMA table_info(calibration_sources)').all().some(c=>c.name==='archived'))d.exec('ALTER TABLE calibration_sources ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  const extra=['source_start','source_end','boundary_note'];
  if(extra.some(name=>!d.prepare('PRAGMA table_info(calibration_records)').all().some(c=>c.name===name))){
    const ownTransaction=!d.isTransaction;if(ownTransaction)d.exec('BEGIN IMMEDIATE');
    try{
      for(const name of extra)if(!d.prepare('PRAGMA table_info(calibration_records)').all().some(c=>c.name===name))d.exec(`ALTER TABLE calibration_records ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
      if(ownTransaction)d.exec('COMMIT');
    }catch(e){if(ownTransaction)d.exec('ROLLBACK');throw e;}
  }
}
export function googleCalibrationUrl(value){
  let u;try{u=new URL(String(value));}catch{throw new CalibrationError('請輸入 Google 試算表網址。');}
  const id=u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)\/(?:edit)?/)?.[1];
  const gid=u.searchParams.get('gid')||new URLSearchParams(u.hash.slice(1)).get('gid');
  if(u.protocol!=='https:'||u.hostname!=='docs.google.com'||!id||!gid||!/^\d+$/.test(gid))throw new CalibrationError('請使用包含 gid 的 Google 試算表分頁網址。');
  return {id,gid,url:`https://docs.google.com/spreadsheets/d/${id}/edit?gid=${gid}`};
}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)throw new CalibrationError(`${label}必填且不可超過 ${max} 字。`);return value.trim();}
export function saveCalibrationSource(d,p,actor){
  ensureCalibrationSchema(d);const now=new Date().toISOString();
  const name=text(p.name,160,'名稱'),url=googleCalibrationUrl(p.url).url;
  if(p.description!==undefined&&(typeof p.description!=='string'||p.description.length>3000))throw new CalibrationError('說明不可超過 3000 字。');
  const description=String(p.description||'').trim();
  if(p.id){
    if(!d.prepare('SELECT id FROM calibration_sources WHERE id=? AND archived=0').get(p.id))throw new CalibrationError('來源不存在。',404);
    d.prepare(`UPDATE calibration_sources SET name=?,url=?,description=?,config_revision=config_revision+1,
      next_check=?,updated_by=?,updated_at=? WHERE id=?`).run(name,url,description,now,actor,now,p.id);
    return p.id;
  }
  const id=randomUUID();
  d.prepare(`INSERT INTO calibration_sources(id,name,url,description,next_check,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)`).run(id,name,url,description,now,actor,now);
  return id;
}
export function nextCalibrationCheck(now=new Date()){
  // Asia/Taipei has a fixed UTC+08:00 offset. Check daily at 02:00 local time.
  const local=new Date(now.getTime()+8*3600000);
  let next=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),2)-8*3600000;
  if(next<=now.getTime())next+=86400000;
  return new Date(next).toISOString();
}
function date(value,end=false){
  const s=String(value||'').trim();if(!s)return null;
  const m=s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if(m){
    const day=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    const check=new Date(day+'T00:00:00Z');
    if(!Number.isFinite(check.getTime())||check.toISOString().slice(0,10)!==day)throw new Error('日期不存在');
    // Date-only End_date includes the full local day; stored intervals are [start,end).
    return new Date(Date.parse(day+'T00:00:00+08:00')+(end?86400000:0)).toISOString();
  }
  if(!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(s)||!Number.isFinite(Date.parse(s)))throw new Error('日期請填 YYYY/MM/DD 或含時區的 ISO 時間');
  date(s.slice(0,10));
  return new Date(s).toISOString();
}
function numeric(s,label,optional=false){
  if(s===undefined||String(s).trim()===''){if(optional)return null;throw new Error(`${label}不可空白`);}
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(String(s).trim()))throw new Error(`${label}必須為數值`);
  const n=Number(s);if(!Number.isFinite(n))throw new Error(`${label}必須為有限數值`);return n;
}
export function calibrationIssueReport(issues){
  return `解析完成，共發現 ${issues.length} 項錯誤／衝突，未採用本次更新。\n`+issues.map(issue=>
    `第 ${issue.rows.join('、')} 列｜設備 ${issue.device||'—'}｜通道 ${issue.channel||'—'}：${issue.reason}`).join('\n');
}
function groupedCalibrationRecords(records){
  const groups=new Map();for(const r of records){const key=r.aslung_id+'|'+r.channel;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  for(const group of groups.values())group.sort((a,b)=>a.start.localeCompare(b.start)||a.row_number-b.row_number);
  return groups;
}
function intervalClusters(group,emit){
  let cluster=[],end='';
  for(const r of group){
    if(cluster.length&&r.start>=end){emit(cluster);cluster=[];end='';}
    cluster.push(r);if((r.end||'9999')>end)end=r.end||'9999';
  }
  if(cluster.length)emit(cluster);
}
export function crossSourceCalibrationIssues(records,others){
  const issues=[];
  const groups=groupedCalibrationRecords([...records.map(r=>({...r,incoming:true})),...others.map(r=>({...r,incoming:false}))]);
  for(const group of groups.values())intervalClusters(group,cluster=>{
    let incomingEnd='',otherEnd='',cross=false;
    for(const r of cluster){
      if(r.incoming){if(otherEnd>r.start)cross=true;incomingEnd=[incomingEnd,r.end||'9999'].sort().at(-1);}
      else{if(incomingEnd>r.start)cross=true;otherEnd=[otherEnd,r.end||'9999'].sort().at(-1);}
    }
    if(!cross)return;
    const incoming=cluster.filter(r=>r.incoming),related=new Map();
    for(const r of cluster.filter(r=>!r.incoming)){const key=r.source_id||r.source_name||'其他來源';if(!related.has(key))related.set(key,{name:r.source_name||key,rows:[]});related.get(key).rows.push(r.row_number);}
    issues.push({rows:[...new Set(incoming.map(r=>r.row_number))].sort((a,b)=>a-b),device:cluster[0].aslung_id,channel:cluster[0].channel,
      reason:'跨來源適用期間衝突；重疊群組涉及 '+[...related.values()].map(v=>`來源「${v.name}」第 ${[...new Set(v.rows)].sort((a,b)=>a-b).join('、')} 列`).join('；')});
  });
  return issues;
}
export function analyzeCalibrationCsv(csv){
  const records=[],issues=[];
  const fatal=reason=>({records,issues:[{rows:[1],device:'',channel:'',reason}]});
  if(typeof csv!=='string'||csv.length>12000000||/^\s*(?:<!doctype|<html)/i.test(csv))return fatal('無法取得校正 CSV，請確認分享權限及內容大小。');
  let table;try{table=parseImportTable(csv);}catch(e){return fatal(e.message);}
  const {headers,rows,rowNumbers}=table,keys=headers.map(h=>h.toLowerCase().trim());
  for(const key of ['aslung_id','pm','slope1','intercept1','start_date'])if(!keys.includes(key))issues.push({rows:[1],device:'',channel:'',reason:`缺少必要欄位：${key}`});
  if(new Set(keys.filter(Boolean)).size!==keys.filter(Boolean).length)issues.push({rows:[1],device:'',channel:'',reason:'欄位名稱重複，請檢查標題列。'});
  if(issues.length)return {records,issues};
  if(!rows.length)return fatal('表單沒有校正資料，保留原版本。');
  if(rows.length>50000)return fatal('單一來源最多 50,000 筆校正資料。');
  rows.forEach((row,i)=>{
    const value=k=>row[keys.indexOf(k)]||'',rawId=value('aslung_id').trim(),pm=value('pm').trim().toUpperCase();
    const channel=pm==='PM125'?'PM125':CHANNELS[pm]||'UNMAPPED:'+pm;
    const issue=reason=>issues.push({rows:[rowNumbers[i]],device:rawId.slice(0,80),channel:channel.slice(0,60),reason});
    const field=fn=>{try{return fn();}catch(e){issue(e.message);return undefined;}};
    const id=field(()=>{if(!/^[A-Za-z0-9_-]{1,80}$/.test(rawId))throw new Error('設備 ID 不正確');return rawId;});
    const validChannel=field(()=>{if(!/^[A-Z0-9._-]{1,40}$/.test(pm))throw new Error('PM 通道格式不正確');return channel;});
    const start=field(()=>{const result=date(value('start_date'));if(!result)throw new Error('Start_date 不可空白');return result;});
    const end=field(()=>date(value('end_date'),true));
    if(start&&end&&end<=start)issue('結束日期必須晚於開始日期');
    const a1=field(()=>numeric(value('slope1'),'slope1')),b1=field(()=>numeric(value('intercept1'),'intercept1'));
    const breakpoint=field(()=>numeric(value('break_point1'),'break_point1',true)),a2=field(()=>numeric(value('slope2'),'slope2',true)),b2=field(()=>numeric(value('intercept2'),'intercept2',true));
    if(a2!==undefined&&b2!==undefined&&breakpoint!==undefined&&((a2===null)!==(b2===null)||(a2!==null&&breakpoint===null)))issue('第二段需同時填寫 break_point1、slope2、intercept2');
    // Valid identities and periods can still reveal conflicts even if a coefficient is malformed.
    if(!id||!validChannel||!start||end===undefined||(end&&end<=start))return;
    const quality=Object.fromEntries(['r2','total_mae','total_rmse','sample','region1_mae','region1_rmse','region2_mae','region2_rmse','high_conc','low_conc'].filter(k=>value(k)!=='').map(k=>[k,value(k)]));
    records.push({aslung_id:id,channel,start,end,a1,b1,breakpoint,a2,b2,row_number:rowNumbers[i],quality:JSON.stringify(quality),source_start:value('start_date').trim(),source_end:value('end_date').trim(),boundary_note:''});
  });
  for(const group of groupedCalibrationRecords(records).values()){
    const starts=new Map();for(const r of group){if(!starts.has(r.start))starts.set(r.start,[]);starts.get(r.start).push(r);}
    const boundaries=[...starts.keys()];
    boundaries.forEach((start,i)=>{
      const same=starts.get(start),next=starts.get(boundaries[i+1])?.[0];
      if(same.length>1)issues.push({rows:same.map(r=>r.row_number).sort((a,b)=>a-b),device:same[0].aslung_id,channel:same[0].channel,reason:'同一設備與通道的開始時間重複'});
      if(!next)return;
      for(const r of same){
        if(!r.end){r.end=implicitCalibrationEnd(next.start);r.boundary_note=`原表未填結束日期，銜接至第 ${next.row_number} 列開始時間前一刻`;}
        else if(r.end>next.start&&/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(r.source_end)&&date(r.source_end)===next.start){
          r.end=next.start;r.boundary_note=`原表結束日期 ${r.source_end} 與第 ${next.row_number} 列開始日期相同，新參數優先，舊參數截止至前一刻`;
        }
      }
    });
    intervalClusters(group,cluster=>{
      if(cluster.length>1&&new Set(cluster.map(r=>r.start)).size>1)issues.push({rows:cluster.map(r=>r.row_number).sort((a,b)=>a-b),device:cluster[0].aslung_id,channel:cluster[0].channel,reason:'適用期間重疊（列出整個重疊群組，包含非相鄰列）'});
    });
  }
  records.sort((a,b)=>a.aslung_id.localeCompare(b.aslung_id)||a.channel.localeCompare(b.channel)||a.start.localeCompare(b.start)||a.row_number-b.row_number);
  issues.sort((a,b)=>a.rows[0]-b.rows[0]);
  return {records,issues};
}
export function parseCalibrationCsv(csv){
  const {records,issues}=analyzeCalibrationCsv(csv);
  if(issues.length)throw new CalibrationError(calibrationIssueReport(issues),400,issues);
  return records;
}
export function currentCalibrationRecords(d,id){
  ensureCalibrationSchema(d);
  return d.prepare(`SELECT r.*,s.id AS source_id,s.name AS source_name FROM calibration_records r
    JOIN calibration_sources s ON s.current_version=r.version_id WHERE s.enabled=1 ${id?'AND r.aslung_id=?':''}
    ORDER BY r.aslung_id,r.channel,r.start`).all(...(id?[id]:[]));
}
function assertNoConflicts(records,others){
  const issues=crossSourceCalibrationIssues(records,others);
  if(issues.length)throw new CalibrationError(calibrationIssueReport(issues),400,issues);
}
export function setCalibrationSourceEnabled(d,id,enabled,actor){
  ensureCalibrationSchema(d);if(typeof enabled!=='boolean')throw new CalibrationError('啟用狀態不正確。');
  const source=d.prepare('SELECT * FROM calibration_sources WHERE id=? AND archived=0').get(id);if(!source)throw new CalibrationError('來源不存在。',404);
  d.exec('BEGIN IMMEDIATE');try{
    if(enabled&&source.current_version)assertNoConflicts(d.prepare('SELECT * FROM calibration_records WHERE version_id=?').all(source.current_version),currentCalibrationRecords(d).filter(r=>r.source_id!==id));
    d.prepare('UPDATE calibration_sources SET enabled=?,config_revision=config_revision+1,next_check=?,updated_by=?,updated_at=? WHERE id=?').run(enabled?1:0,new Date().toISOString(),actor,new Date().toISOString(),id);
    d.exec('COMMIT');
  }catch(e){d.exec('ROLLBACK');throw e;}
}
export async function syncCalibrationSource(d,id,actor,fetchCsv,{force=false}={}){
  ensureCalibrationSchema(d);const owner=randomUUID(),now=new Date();
  const source=d.prepare(`UPDATE calibration_sources SET lease_owner=?,lease_until=?
    WHERE id=? AND enabled=1 AND lease_until<=? ${force?'':'AND next_check<=?'} RETURNING *`)
    .get(owner,now.getTime()+120000,id,now.getTime(),...(force?[]:[now.toISOString()]));
  if(!source)return {status:'SKIPPED',message:'來源已停用、尚未到排程時間或正在同步。'};
  let inputCsv=null;
  try{
    const csv=await fetchCsv(source);inputCsv=typeof csv==='string'&&csv.length<=12000000&&!/^\s*(?:<!doctype|<html)/i.test(csv)?csv:null;
    const analysis=analyzeCalibrationCsv(csv),records=analysis.records;
    d.exec('BEGIN IMMEDIATE');try{
      const latest=d.prepare('SELECT * FROM calibration_sources WHERE id=?').get(id);
      if(latest.lease_owner!==owner||latest.lease_until<=Date.now()||latest.config_revision!==source.config_revision||!latest.enabled)throw new CalibrationError('同步期間來源設定已變更，請重新同步。',409);
      const issues=[...analysis.issues,...crossSourceCalibrationIssues(records,currentCalibrationRecords(d).filter(r=>r.source_id!==id))].sort((a,b)=>a.rows[0]-b.rows[0]);
      if(issues.length)throw new CalibrationError(calibrationIssueReport(issues),400,issues);
      const hash=createHash('sha256').update(JSON.stringify(records)).digest('hex');
      const status=hash===latest.content_hash?'UNCHANGED':'UPDATED';
      if(status==='UPDATED'){
        const version=Number(d.prepare(`INSERT INTO calibration_versions(source_id,content_hash,name,url,record_count,created_at,created_by) VALUES(?,?,?,?,?,?,?)`).run(id,hash,source.name,source.url,records.length,new Date().toISOString(),actor).lastInsertRowid);
        const insert=d.prepare('INSERT INTO calibration_records(version_id,aslung_id,channel,start,end,a1,b1,breakpoint,a2,b2,row_number,quality,source_start,source_end,boundary_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        for(const r of records)insert.run(version,r.aslung_id,r.channel,r.start,r.end,r.a1,r.b1,r.breakpoint,r.a2,r.b2,r.row_number,r.quality,r.source_start,r.source_end,r.boundary_note);
        d.prepare('UPDATE calibration_sources SET current_version=?,content_hash=? WHERE id=?').run(version,hash,id);
      }
      const unmapped=records.filter(r=>r.channel.startsWith('UNMAPPED:')).length;
      const lookupOnly=records.filter(r=>r.channel==='PM125').length;
      const adjusted=records.filter(r=>r.boundary_note).length;
      const finished=new Date(),message=(status==='UPDATED'?`已同步 ${records.length} 筆參數`:'內容未變更，沿用目前版本')+(adjusted?`；${adjusted} 筆已依下一筆開始時間銜接`:'')+(lookupOnly?`；${lookupOnly} 筆 PM125 僅供查詢、不套用計算`:'')+(unmapped?`；${unmapped} 筆通道待對應，僅供查詢、不套用計算`:'');
      d.prepare('UPDATE calibration_sources SET last_check=?,last_success=?,last_status=?,last_error=NULL,next_check=? WHERE id=?').run(finished.toISOString(),finished.toISOString(),status,nextCalibrationCheck(finished),id);
      const log=nextCalibrationLogId(d);
      d.prepare('INSERT INTO calibration_sync_logs(id,source_id,status,message,record_count,created_at,actor) VALUES(?,?,?,?,?,?,?)').run(log,id,status,message,records.length,finished.toISOString(),actor);
      captureCalibrationImport(d,log,source,inputCsv,[],d.prepare('SELECT current_version FROM calibration_sources WHERE id=?').get(id).current_version);
      d.exec('COMMIT');return {status,message,recordCount:records.length};
    }catch(e){d.exec('ROLLBACK');throw e;}
  }catch(e){
    const finished=new Date(),message=String(e.message||'同步失敗');
    const live=d.prepare('SELECT * FROM calibration_sources WHERE id=?').get(id);
    if(live?.lease_owner===owner){
      if(live.config_revision===source.config_revision)d.prepare('UPDATE calibration_sources SET last_check=?,last_status=\'FAILED\',last_error=?,next_check=? WHERE id=?').run(finished.toISOString(),message,nextCalibrationCheck(finished),id);
      d.exec('BEGIN IMMEDIATE');try{
        const log=nextCalibrationLogId(d);
        d.prepare('INSERT INTO calibration_sync_logs(id,source_id,status,message,created_at,actor) VALUES(?,?,\'FAILED\',?,?,?)').run(log,id,message,finished.toISOString(),actor);
        captureCalibrationImport(d,log,source,inputCsv,e.issues||[],null);
        d.exec('COMMIT');
      }catch(historyError){d.exec('ROLLBACK');throw historyError;}
    }
    return {status:'FAILED',message,issueCount:e.issues?.length||0};
  }finally{d.prepare('UPDATE calibration_sources SET lease_owner=NULL,lease_until=0 WHERE id=? AND lease_owner=?').run(id,owner);}
}
function nextCalibrationLogId(d){
  // The legacy log table has no AUTOINCREMENT. Deleted log IDs remain reserved
  // by retained audit events, so old links and audits cannot refer to new imports.
  return Number(d.prepare(`SELECT COALESCE(MAX(id),0)+1 AS id FROM (
    SELECT id FROM calibration_sync_logs UNION ALL SELECT log_id AS id FROM calibration_history_events)`).get().id);
}
function captureCalibrationImport(d,log,source,csv,issues,version){
  const hash=csv===null?null:createHash('sha256').update(csv).digest('hex');
  if(hash)d.prepare('INSERT OR IGNORE INTO calibration_import_files(hash,csv_gzip) VALUES(?,?)').run(hash,gzipSync(csv));
  d.prepare(`INSERT INTO calibration_import_details(log_id,source_name,source_url,source_description,version_id,file_hash,issues_json,captured)
    VALUES(?,?,?,?,?,?,?,1)`).run(log,source.name,source.url,source.description,version,hash,JSON.stringify(issues));
}
const historyJoin=` FROM calibration_sync_logs l JOIN calibration_sources s ON s.id=l.source_id
  LEFT JOIN calibration_import_details h ON h.log_id=l.id`;
const historyColumns=`l.*,COALESCE(h.source_name,s.name) AS source_name,COALESCE(h.source_url,s.url) AS source_url,
  COALESCE(h.source_description,s.description) AS source_description,s.archived AS source_archived,
  h.version_id,h.file_hash IS NOT NULL AS has_file,COALESCE(h.captured,0) AS has_snapshot,
  COALESCE(h.note,'') AS note,COALESCE(h.revision,0) AS revision,h.updated_by,h.updated_at`;
function historyId(id){if(!Number.isSafeInteger(id)||id<1)throw new CalibrationError('紀錄編號不正確。');return id;}
export function listCalibrationHistory(d,{source='',offset=0}={}){
  ensureCalibrationSchema(d);
  if(typeof source!=='string'||source.length>80||!Number.isSafeInteger(offset)||offset<0)throw new CalibrationError('查詢參數不正確。');
  const where=' WHERE (?=\'\' OR l.source_id=?)',args=[source,source];
  const total=Number(d.prepare('SELECT COUNT(*) n '+historyJoin+where).get(...args).n);
  const logs=d.prepare('SELECT '+historyColumns+historyJoin+where+' ORDER BY l.id DESC LIMIT 50 OFFSET ?').all(...args,offset);
  // Long error reports are loaded only when the corresponding row is opened.
  for(const log of logs)log.message=log.message.split('\n')[0];
  return {logs,total,offset,hasMore:offset+logs.length<total};
}
export function calibrationHistoryDetail(d,id,offset=0){
  ensureCalibrationSchema(d);historyId(id);
  if(!Number.isSafeInteger(offset)||offset<0)throw new CalibrationError('分頁不正確。');
  const log=d.prepare('SELECT '+historyColumns+historyJoin+' WHERE l.id=?').get(id);
  if(!log)throw new CalibrationError('匯入紀錄不存在。',404);
  const meta=d.prepare('SELECT issues_json FROM calibration_import_details WHERE log_id=?').get(id);
  const records=log.version_id?d.prepare('SELECT * FROM calibration_records WHERE version_id=? ORDER BY row_number LIMIT 100 OFFSET ?').all(log.version_id,offset):[];
  const total=log.version_id?Number(d.prepare('SELECT COUNT(*) n FROM calibration_records WHERE version_id=?').get(log.version_id).n):0;
  return {log,issues:JSON.parse(meta?.issues_json||'[]'),records,total,offset,hasMore:offset+records.length<total};
}
export function calibrationHistoryFiles(d,id){
  const detail=calibrationHistoryDetail(d,id);
  const file=d.prepare(`SELECT f.csv_gzip FROM calibration_import_files f JOIN calibration_import_details h ON h.file_hash=f.hash WHERE h.log_id=?`).get(id);
  return {...detail,csv:file?gunzipSync(file.csv_gzip).toString('utf8'):null,
    records:detail.log.version_id?d.prepare('SELECT * FROM calibration_records WHERE version_id=? ORDER BY row_number').all(detail.log.version_id):[]};
}
function historyEvent(d,{log=null,source,action,actor,before,after}){
  d.prepare('INSERT INTO calibration_history_events(log_id,source_id,action,actor,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(log,source,action,actor,JSON.stringify(before),JSON.stringify(after),new Date().toISOString());
}
export function editCalibrationHistory(d,{id,note,revision},actor){
  ensureCalibrationSchema(d);historyId(id);
  if(typeof note!=='string'||note.length>3000||!Number.isSafeInteger(revision)||revision<0)throw new CalibrationError('備註不可超過 3000 字，並需提供目前版本。');
  d.exec('BEGIN IMMEDIATE');try{
    const {log}=calibrationHistoryDetail(d,id);
    if(log.revision!==revision)throw new CalibrationError('紀錄已被其他人更新，請重新整理後再編輯。',409);
    d.prepare(`INSERT OR IGNORE INTO calibration_import_details(log_id,source_name,source_url,source_description) VALUES(?,?,?,?)`).run(id,log.source_name,log.source_url,log.source_description);
    d.prepare('UPDATE calibration_import_details SET note=?,revision=revision+1,updated_by=?,updated_at=? WHERE log_id=?').run(note.trim(),actor,new Date().toISOString(),id);
    historyEvent(d,{log:id,source:log.source_id,action:'EDIT_NOTE',actor,before:{note:log.note,revision},after:{note:note.trim(),revision:revision+1}});
    d.exec('COMMIT');return {ok:true};
  }catch(e){d.exec('ROLLBACK');throw e;}
}
export function deleteCalibrationHistory(d,ids,actor){
  ensureCalibrationSchema(d);
  if(!Array.isArray(ids)||!ids.length||ids.length>100)throw new CalibrationError('每次請選取 1–100 筆紀錄。');
  ids=[...new Set(ids.map(historyId))];
  d.exec('BEGIN IMMEDIATE');try{
    for(const id of ids){
      const {log}=calibrationHistoryDetail(d,id);
      historyEvent(d,{log:id,source:log.source_id,action:'DELETE_LOG',actor,before:log,after:null});
      d.prepare('DELETE FROM calibration_import_details WHERE log_id=?').run(id);
      d.prepare('DELETE FROM calibration_sync_logs WHERE id=?').run(id);
    }
    d.prepare('DELETE FROM calibration_import_files WHERE NOT EXISTS(SELECT 1 FROM calibration_import_details h WHERE h.file_hash=calibration_import_files.hash)').run();
    d.exec('COMMIT');return {ok:true,deleted:ids.length};
  }catch(e){d.exec('ROLLBACK');throw e;}
}
export function archiveCalibrationSource(d,id,actor){
  ensureCalibrationSchema(d);
  if(typeof id!=='string'||id.length>80)throw new CalibrationError('來源編號不正確。');
  d.exec('BEGIN IMMEDIATE');try{
    const source=d.prepare('SELECT * FROM calibration_sources WHERE id=? AND archived=0').get(id);
    if(!source)throw new CalibrationError('來源不存在。',404);
    if(source.lease_until>Date.now())throw new CalibrationError('此來源正在同步，請等候同步完成再刪除。',409);
    d.prepare('UPDATE calibration_sources SET archived=1,enabled=0,config_revision=config_revision+1,updated_by=?,updated_at=? WHERE id=?').run(actor,new Date().toISOString(),id);
    historyEvent(d,{source:id,action:'ARCHIVE_SOURCE',actor,before:{name:source.name,url:source.url,enabled:source.enabled},after:{archived:1,enabled:0}});
    d.exec('COMMIT');return {ok:true};
  }catch(e){d.exec('ROLLBACK');throw e;}
}
export function calibrateRows(rows,records){
  const groups=new Map();for(const r of records){const key=r.aslung_id+'|'+r.channel;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  return rows.map(row=>{
    const result={...row};
    for(const channel of Object.values(CHANNELS)){
      const raw=row[channel],timestamp=Date.parse(row.timestamp);
      const matches=(groups.get(row.aslung_id+'|'+channel)||[]).filter(r=>timestamp>=Date.parse(r.start)&&(!r.end||timestamp<Date.parse(r.end)));
      const rule=matches.length===1?matches[0]:null;
      const valid=typeof raw==='number'&&Number.isFinite(raw);
      const second=rule?.a2!==null&&rule?.a2!==undefined&&raw>=rule.breakpoint;
      const value=rule&&valid?(second?rule.a2:rule.a1)*raw+(second?rule.b2:rule.b1):null;
      result[channel+'_calibrated']=Number.isFinite(value)?value:null;
      result[channel+'_calibration_status']=!valid?'INVALID_RAW':matches.length>1?'CONFLICT':!rule?'NO_FACTOR':Number.isFinite(value)?'CALIBRATED':'INVALID_RESULT';
      result[channel+'_calibration_version']=rule?.version_id??null;
      result[channel+'_calibration_record']=rule?.id??null;
    }
    return result;
  });
}
