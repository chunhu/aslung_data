import {randomUUID,createHash} from 'node:crypto';
import {CalibrationError,CHANNELS,parseCalibrationCsv,googleCalibrationUrl,nextCalibrationCheck} from './calibration.mjs';

export function ensurePersonalSchema(d){
  d.exec(`CREATE TABLE IF NOT EXISTS device_claims(
    id TEXT PRIMARY KEY,email TEXT NOT NULL,device_id TEXT NOT NULL,evidence TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',created_at TEXT NOT NULL,reviewed_at TEXT,reviewed_by TEXT,note TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX IF NOT EXISTS device_claim_pending ON device_claims(email,device_id) WHERE status='PENDING';
    CREATE TABLE IF NOT EXISTS device_ownerships(
    id TEXT PRIMARY KEY,email TEXT NOT NULL,device_id TEXT NOT NULL REFERENCES devices(id),start TEXT NOT NULL,end TEXT,
    calibration_enabled INTEGER NOT NULL DEFAULT 1,grant_id INTEGER,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS device_owner_current ON device_ownerships(device_id) WHERE end IS NULL;
    CREATE INDEX IF NOT EXISTS device_owner_email ON device_ownerships(email,end);
    CREATE TABLE IF NOT EXISTS personal_sources(
    id TEXT PRIMARY KEY,email TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,url TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,auto_sync INTEGER NOT NULL DEFAULT 0,manual INTEGER NOT NULL DEFAULT 0,
    allow_overwrite INTEGER NOT NULL DEFAULT 0,current_version INTEGER,next_check TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,
    last_status TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT '',last_success TEXT,archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS personal_versions(
    id INTEGER PRIMARY KEY,source_id TEXT NOT NULL REFERENCES personal_sources(id),email TEXT NOT NULL,
    records_json TEXT NOT NULL,content_hash TEXT NOT NULL,input_csv TEXT,created_at TEXT NOT NULL,created_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS personal_events(
    id INTEGER PRIMARY KEY,email TEXT NOT NULL,device_id TEXT,source_id TEXT,action TEXT NOT NULL,actor TEXT NOT NULL,
    detail TEXT NOT NULL,created_at TEXT NOT NULL);`);
}
const now=()=>new Date().toISOString();
function error(message,status=400){throw new CalibrationError(message,status);}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)error(label+'格式不正確。');return value.trim();}
function researcher(me){if(!['member','admin'].includes(me.role))error('此功能限研究會員與系統管理員使用。',403);}
function administrator(me){if(me.role!=='admin')error('只有系統管理員可以審核設備歸屬。',403);}
function audit(d,me,action,detail={},device=null,source=null,email=me.email){d.prepare('INSERT INTO personal_events(email,device_id,source_id,action,actor,detail,created_at) VALUES(?,?,?,?,?,?,?)').run(email,device,source,action,me.email,JSON.stringify(detail),now());}
function liveActor(d,me){const actor=d.prepare('SELECT active,role FROM members WHERE email=?').get(me.email);if(!actor?.active||actor.role!==me.role)error('帳號權限已變更，請重新整理。',403);}
function transaction(d,me,fn){d.exec('BEGIN IMMEDIATE');try{liveActor(d,me);const value=fn();d.exec('COMMIT');return value;}catch(e){d.exec('ROLLBACK');throw e;}}
function sourceFor(d,me,id){if(typeof id!=='string')error('來源 ID 不正確。');const s=d.prepare('SELECT * FROM personal_sources WHERE id=? AND email=? AND archived=0').get(id,me.email);if(!s)error('找不到您的校正來源。',404);return s;}
function ownership(d,email,device){return d.prepare('SELECT * FROM device_ownerships WHERE email=? AND device_id=? AND end IS NULL AND start<=? AND calibration_enabled=1').get(email,device,now());}
function assertDevices(d,email,records){
  const member=d.prepare('SELECT active,role FROM members WHERE email=?').get(email);
  if(!member?.active||!['member','admin'].includes(member.role))error('帳號沒有個人校正權限。',403);
  for(const id of new Set(records.map(r=>r.aslung_id)))if(!ownership(d,email,id))error('設備 '+id+' 未核准歸屬或未開啟個人校正權限。',403);
}
function recordsOf(d,version){return version?JSON.parse(d.prepare('SELECT records_json FROM personal_versions WHERE id=?').get(version)?.records_json||'[]'):[];}
function conflicts(d,s,records){
  const other=d.prepare('SELECT current_version FROM personal_sources WHERE email=? AND id<>? AND enabled=1 AND archived=0').all(s.email,s.id).flatMap(r=>recordsOf(d,r.current_version));
  for(const a of records)for(const b of other)if(a.aslung_id===b.aslung_id&&a.channel===b.channel&&a.start<(b.end||'9999')&&b.start<(a.end||'9999'))error('個人來源之間適用期間重疊：'+a.aslung_id+' / '+a.channel);
}
export function requestDevice(d,me,p){
  ensurePersonalSchema(d);researcher(me);const device=text(p.device_id,80,'設備 ID');if(!/^[A-Za-z0-9_-]+$/.test(device))error('設備 ID 格式不正確。');
  const evidence=text(p.evidence,3000,'購買或歸屬說明');
  return transaction(d,me,()=>{
    if(d.prepare("SELECT 1 FROM device_claims WHERE email=? AND device_id=? AND status='PENDING'").get(me.email,device))error('此設備已有待審核申請。',409);
    if(d.prepare('SELECT 1 FROM device_ownerships WHERE email=? AND device_id=? AND end IS NULL').get(me.email,device))error('此設備已綁定您的帳號。',409);
    const id=randomUUID();d.prepare('INSERT INTO device_claims(id,email,device_id,evidence,created_at) VALUES(?,?,?,?,?)').run(id,me.email,device,evidence,now());audit(d,me,'REQUEST_DEVICE',{claim:id},device);return {ok:true};
  });
}
export function reviewDevice(d,me,p){
  ensurePersonalSchema(d);administrator(me);
  if(!['approve','reject'].includes(p.decision)||typeof p.calibration_enabled!=='boolean')error('審核內容不正確。');
  const note=typeof p.note==='string'&&p.note.length<=3000?p.note.trim():'';
  return transaction(d,me,()=>{
    const claim=d.prepare("SELECT * FROM device_claims WHERE id=? AND status='PENDING'").get(p.id);if(!claim)error('申請已處理或不存在。',409);
    if(p.decision==='approve'){
      if(p.confirmed!==true)error('請先確認設備身分與資料接收設定。');
      const member=d.prepare('SELECT active,role FROM members WHERE email=?').get(claim.email);if(!member?.active||!['member','admin'].includes(member.role))error('申請人不是啟用中的研究會員。');
      const start=text(p.start,60,'資料起日');if(!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d\d:\d\d)$/.test(start)||!Number.isFinite(Date.parse(start))||Date.parse(start)>Date.now())error('請設定有效的資料可讀起日（不可晚於現在）。');
      const canonical=new Date(start).toISOString();
      if(d.prepare('SELECT 1 FROM device_ownerships WHERE device_id=? AND end IS NULL').get(claim.device_id))error('設備已有擁有者，請先解除原綁定。',409);
      const previous=d.prepare('SELECT MAX(end) AS latest FROM device_ownerships WHERE device_id=?').get(claim.device_id)?.latest;
      if(previous&&canonical<previous)error('資料起日不可早於前一位擁有者的交接時間。');
      if(!d.prepare('SELECT 1 FROM devices WHERE id=?').get(claim.device_id)){
        if(p.create_device!==true)error('設備尚未建檔，請勾選建立設備或先至 ASLUNG ID 管理新增。');
        d.prepare("INSERT INTO devices(id,name,status) VALUES(?,?,'STANDBY')").run(claim.device_id,claim.device_id);
      }
      const grant=Number(d.prepare("INSERT INTO grants(grant_type,device_id,email,start,end) VALUES('device',?,?,?,NULL)").run(claim.device_id,claim.email,canonical).lastInsertRowid);
      d.prepare('INSERT INTO device_ownerships(id,email,device_id,start,calibration_enabled,grant_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),claim.email,claim.device_id,canonical,p.calibration_enabled?1:0,grant,me.email,now());
    }
    d.prepare('UPDATE device_claims SET status=?,reviewed_at=?,reviewed_by=?,note=? WHERE id=?').run(p.decision==='approve'?'APPROVED':'REJECTED',now(),me.email,note,claim.id);
    audit(d,me,'REVIEW_DEVICE',{...p,evidence:undefined},claim.device_id,null,claim.email);return {ok:true};
  });
}
export function manageOwnership(d,me,p){
  ensurePersonalSchema(d);administrator(me);
  return transaction(d,me,()=>{
    const o=d.prepare('SELECT * FROM device_ownerships WHERE id=? AND end IS NULL').get(p.id);if(!o)error('找不到有效綁定。',404);
    if(p.action==='revoke'){
      if(p.confirmation!=='REVOKE')error('請輸入 REVOKE 確認解除綁定。');
      const end=now();d.prepare('UPDATE device_ownerships SET end=? WHERE id=?').run(end,o.id);
      d.prepare('UPDATE grants SET end=? WHERE id=? AND email=? AND device_id=?').run(new Date(Date.parse(end)-1).toISOString(),o.grant_id,o.email,o.device_id);
    }else if(p.action==='calibrationPermission'){
      if(typeof p.enabled!=='boolean')error('權限設定不正確。');d.prepare('UPDATE device_ownerships SET calibration_enabled=? WHERE id=?').run(p.enabled?1:0,o.id);
    }else error('操作不正確。');
    audit(d,me,p.action,{id:o.id,enabled:p.enabled},o.device_id,null,o.email);return {ok:true};
  });
}
export function personalState(d,me){
  ensurePersonalSchema(d);researcher(me);
  return {claims:d.prepare('SELECT c.*,m.name AS member_name FROM device_claims c LEFT JOIN members m ON m.email=c.email WHERE (?=1 OR c.email=?) ORDER BY c.created_at DESC').all(me.role==='admin'?1:0,me.email),
    ownerships:d.prepare('SELECT o.*,m.name AS member_name FROM device_ownerships o LEFT JOIN members m ON m.email=o.email WHERE (?=1 OR o.email=?) ORDER BY o.device_id,o.created_at DESC').all(me.role==='admin'?1:0,me.email),
    sources:d.prepare('SELECT * FROM personal_sources WHERE email=? AND archived=0 ORDER BY name').all(me.email),
    events:d.prepare('SELECT * FROM personal_events WHERE (?=1 OR email=?) ORDER BY id DESC LIMIT 100').all(me.role==='admin'?1:0,me.email)};
}
export function savePersonalSource(d,me,p){
  ensurePersonalSchema(d);researcher(me);const name=text(p.name,160,'來源名稱');
  if(!['CSV','GOOGLE'].includes(p.kind)||typeof p.auto_sync!=='boolean')error('來源設定不正確。');
  const url=p.kind==='GOOGLE'?googleCalibrationUrl(p.url).url:'';
  return transaction(d,me,()=>{
    if(d.prepare('SELECT COUNT(*) n FROM personal_sources WHERE email=? AND archived=0').get(me.email).n>=20)error('每位會員最多 20 個來源。');
    if(!d.prepare('SELECT 1 FROM device_ownerships WHERE email=? AND end IS NULL AND calibration_enabled=1 AND start<=?').get(me.email,now()))error('請先申請設備綁定及個人校正權限。',403);
    const id=randomUUID();d.prepare('INSERT INTO personal_sources(id,email,name,kind,url,auto_sync,next_check) VALUES(?,?,?,?,?,?,?)').run(id,me.email,name,p.kind,url,p.kind==='GOOGLE'&&p.auto_sync?1:0,now());audit(d,me,'CREATE_SOURCE',{name,kind:p.kind},null,id);return {ok:true,id};
  });
}
export function personalSourceAction(d,me,p){
  ensurePersonalSchema(d);researcher(me);
  return transaction(d,me,()=>{
    const s=sourceFor(d,me,p.id);if(s.lease_until>Date.now())error('來源正在同步，請稍後再操作。',409);
    if(p.action==='sourceDelete'){
      if(p.confirmation!=='DELETE')error('請輸入 DELETE 確認。');d.prepare('UPDATE personal_sources SET archived=1,enabled=0,auto_sync=0,revision=revision+1 WHERE id=?').run(s.id);
    }else if(p.action==='sourceSettings'){
      if(typeof p.enabled!=='boolean'||typeof p.auto_sync!=='boolean'||typeof p.allow_overwrite!=='boolean'||p.version!==s.current_version)error('來源版本或設定已變更，請重新整理。',409);
      if(p.enabled){const records=recordsOf(d,s.current_version);assertDevices(d,me.email,records);conflicts(d,s,records);}
      d.prepare('UPDATE personal_sources SET enabled=?,auto_sync=?,allow_overwrite=?,revision=revision+1 WHERE id=?').run(p.enabled?1:0,s.kind==='GOOGLE'&&p.auto_sync?1:0,p.allow_overwrite?1:0,s.id);
    }else error('操作不正確。');
    audit(d,me,p.action,p,null,s.id);return {ok:true};
  });
}
export function previewPersonalCsv(d,me,csv){
  ensurePersonalSchema(d);researcher(me);if(typeof csv!=='string'||Buffer.byteLength(csv)>2000000)error('CSV 不可超過 2 MB。');
  const records=parseCalibrationCsv(csv);if(records.length>5000)error('每個來源最多 5000 筆參數。');assertDevices(d,me.email,records);
  return {records,count:records.length};
}
function publish(d,me,s,records,csv,manual,actor=me.email){
  assertDevices(d,s.email,records);if(s.enabled)conflicts(d,s,records);
  const hash=createHash('sha256').update(JSON.stringify(records)).digest('hex');
  const prior=s.current_version?d.prepare('SELECT content_hash FROM personal_versions WHERE id=?').get(s.current_version):null;
  const version=!manual&&prior?.content_hash===hash?s.current_version:Number(d.prepare('INSERT INTO personal_versions(source_id,email,records_json,content_hash,input_csv,created_at,created_by) VALUES(?,?,?,?,?,?,?)').run(s.id,s.email,JSON.stringify(records),hash,csv,now(),actor).lastInsertRowid);
  d.prepare("UPDATE personal_sources SET current_version=?,manual=?,allow_overwrite=0,revision=revision+1,last_status=?,last_error='',last_success=?,next_check=? WHERE id=?").run(version,manual?1:0,manual?'MANUAL':'UPDATED',now(),nextCalibrationCheck(new Date()),s.id);
  audit(d,{...me,email:actor},manual?'MANUAL_PARAMETERS':'IMPORT_PARAMETERS',{version,count:records.length},null,s.id,s.email);return {ok:true,version,count:records.length};
}
export function importPersonalCsv(d,me,p){
  const {records}=previewPersonalCsv(d,me,p.csv);
  return transaction(d,me,()=>{const s=sourceFor(d,me,p.id);if(s.kind!=='CSV'||s.lease_until>Date.now()||p.version!==s.current_version)error('來源種類、版本或同步狀態已變更。',409);return publish(d,me,s,records,p.csv,false);});
}
export function personalRecords(d,me,id,version){
  ensurePersonalSchema(d);researcher(me);const s=sourceFor(d,me,id);
  const v=version==null||version===''?s.current_version:Number(version);
  if(!v)return {source:s,version:null,records:[],versions:[]};
  const stored=d.prepare('SELECT * FROM personal_versions WHERE id=? AND source_id=? AND email=?').get(v,s.id,me.email);if(!stored)error('找不到您的校正版本。',404);
  return {source:s,version:v,records:JSON.parse(stored.records_json).map((r,i)=>({...r,id:i+1,version_id:v,source_name:s.name,source_enabled:s.enabled,is_current:v===s.current_version?1:0})),versions:d.prepare('SELECT id,created_at,created_by FROM personal_versions WHERE source_id=? AND email=? ORDER BY id DESC').all(s.id,me.email)};
}
export function personalRecordsCsv(records){
  const external=channel=>Object.entries(CHANNELS).find(([,value])=>value===channel)?.[0]||String(channel).replace(/^UNMAPPED:/,'');
  const cells=records.map(r=>[r.aslung_id,external(r.channel),r.a1,r.b1,r.breakpoint,r.a2,r.b2,r.start,r.end]);
  return 'aslung_id,PM,slope1,intercept1,break_point1,slope2,intercept2,Start_date,End_date\n'+cells.map(row=>row.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\n');
}
export function mutatePersonalRecords(d,me,p){
  ensurePersonalSchema(d);researcher(me);
  return transaction(d,me,()=>{
    const s=sourceFor(d,me,p.source_id);if(s.lease_until>Date.now()||s.current_version!==p.version)error('來源版本或同步狀態已變更。',409);
    let records=recordsOf(d,s.current_version);assertDevices(d,me.email,records);
    if(!Array.isArray(p.ids)||!p.ids.length||p.ids.length>200||p.ids.some(id=>!Number.isSafeInteger(id)||id<1||id>records.length))error('請選擇有效參數（每批最多 200 筆）。');
    const ids=new Set(p.ids);
    if(p.operation==='delete'){if(p.confirmation!=='DELETE')error('請輸入 DELETE 確認。');records=records.filter((_,i)=>!ids.has(i+1));}
    else if(p.operation==='edit'){
      const allowed=['aslung_id','channel','start','end','a1','b1','breakpoint','a2','b2'];
      if(ids.size!==1||!p.patch||Array.isArray(p.patch)||Object.keys(p.patch).some(k=>!allowed.includes(k)))error('修改內容不正確。');
      records=records.map((r,i)=>ids.has(i+1)?{...r,...p.patch}:r);
      const parsed=previewPersonalCsv(d,me,personalRecordsCsv(records)).records;
      records=parsed.map(r=>{const i=r.row_number-2,old=records[i];return {...r,row_number:old.row_number,source_start:old.source_start,source_end:old.source_end,quality:old.quality,manual_edited_at:ids.has(i+1)?now():old.manual_edited_at||'',manual_edited_by:ids.has(i+1)?me.email:old.manual_edited_by||''};});
    }else error('操作不正確。');
    return {...publish(d,me,s,records,null,true),message:'已建立個人新版本，預設保護手動修改。'};
  });
}
export async function syncPersonalSource(d,me,id,fetchCsv,{scheduled=false}={}){
  ensurePersonalSchema(d);const initial=sourceFor(d,me,id);researcher(me);
  if(initial.kind!=='GOOGLE'||!initial.enabled||initial.manual&&!initial.allow_overwrite||scheduled&&(!initial.auto_sync||initial.next_check>now()))return {status:'SKIPPED',message:'來源停用、手動修改受保護或尚未到同步時間。'};
  const owner=randomUUID();const s=d.prepare('UPDATE personal_sources SET lease=?,lease_until=? WHERE id=? AND lease_until<=? RETURNING *').get(owner,Date.now()+120000,id,Date.now());if(!s)return {status:'SKIPPED',message:'來源正在同步。'};
  try{
    assertDevices(d,me.email,recordsOf(d,s.current_version));
    if(!d.prepare('SELECT 1 FROM device_ownerships WHERE email=? AND end IS NULL AND calibration_enabled=1 AND start<=?').get(me.email,now()))error('尚無核准的個人校正設備。',403);
    const csv=await fetchCsv(s),{records}=previewPersonalCsv(d,me,csv);
    return transaction(d,me,()=>{
      const live=sourceFor(d,me,id);if(live.revision!==s.revision||live.lease!==owner||live.lease_until<=Date.now())error('同步期間設定已變更。',409);
      const result=publish(d,me,live,records,csv,false,scheduled?'scheduler':me.email);return {...result,status:'UPDATED',message:'個人參數已同步。'};
    });
  }catch(e){
    d.prepare("UPDATE personal_sources SET last_status='FAILED',last_error=?,next_check=? WHERE id=? AND lease=?").run(String(e.message),nextCalibrationCheck(new Date()),id,owner);
    audit(d,scheduled?{...me,email:'scheduler'}:me,'SYNC_FAILED',{message:String(e.message)},null,id,me.email);return {status:'FAILED',message:String(e.message)};
  }finally{d.prepare('UPDATE personal_sources SET lease=NULL,lease_until=0 WHERE id=? AND lease=?').run(id,owner);}
}
export function personalQueryRecords(d,me,device,snapshot){
  ensurePersonalSchema(d);researcher(me);assertDevices(d,me.email,[{aslung_id:device}]);
  let versions;
  if(snapshot!=null){
    if(!/^personal:(?:none|[1-9]\d*(?:,[1-9]\d*){0,19})$/.test(snapshot))error('個人校正版本格式不正確。');
    const suffix=snapshot.slice(9),ids=suffix==='none'?[]:[...new Set(suffix.split(',').map(Number))];
    versions=ids.map(id=>{const v=d.prepare('SELECT * FROM personal_versions WHERE id=? AND email=?').get(id,me.email);if(!v)error('無權存取此個人校正版本。',403);return v;});
    if(new Set(versions.map(v=>v.source_id)).size!==versions.length)error('同來源不可混用多個版本。');
  }else versions=d.prepare('SELECT v.* FROM personal_sources s JOIN personal_versions v ON v.id=s.current_version WHERE s.email=? AND s.archived=0 AND s.enabled=1').all(me.email);
  const used=versions.filter(v=>JSON.parse(v.records_json).some(r=>r.aslung_id===device));
  const records=used.flatMap(v=>JSON.parse(v.records_json).map((r,i)=>({...r,id:i+1,version_id:v.id})).filter(r=>r.aslung_id===device));
  return {records,snapshot:'personal:'+(used.map(v=>v.id).join(',')||'none')};
}
