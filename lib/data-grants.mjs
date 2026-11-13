export class DataGrantError extends Error {
  constructor(status,message){super(message);this.status=status;}
}

// One transaction for the entire selection: an invalid target never leaves partial access.
/**
 * @param {any} d
 * @param {{email:string}} actor
 * @param {{grantType:unknown,targets:unknown,email:unknown,start:string,end?:string|null}} input
 */
export function createBulkGrants(d,actor,{grantType,targets,email,start,end=null}){
  const bad=message=>{throw new DataGrantError(400,message);};
  if(!['lab','device'].includes(grantType))bad('請選擇正確的授權類型。');
  if(!Array.isArray(targets)||!targets.length||targets.length>10000||targets.some(id=>typeof id!=='string'||!id.trim()))bad('請選擇 1 至 10000 個有效授權標的。');
  const ids=[...new Set(targets.map(id=>id.trim()))];
  if(typeof email!=='string'||!email.trim())bad('請選擇會員。');
  email=email.trim();
  if(!Number.isFinite(Date.parse(start))||(end!==null&&!Number.isFinite(Date.parse(end))))bad('請提供有效日期。');
  start=new Date(start).toISOString();end=end===null?null:new Date(end).toISOString();
  if(end&&start>end)bad('結束時間必須晚於開始時間。');
  d.exec('BEGIN IMMEDIATE');
  try{
    const admin=d.prepare('SELECT role,active FROM members WHERE email=?').get(actor?.email);
    if(!admin||admin.role!=='admin'||!admin.active)throw new DataGrantError(403,'只有啟用中的系統管理員可以指派授權。');
    const member=d.prepare('SELECT role,active FROM members WHERE email=?').get(email);
    if(!member||member.role!=='member'||!member.active)bad('請選擇已啟用的研究會員。');
    const table=grantType==='lab'?'labs':'devices',column=grantType==='lab'?'lab_id':'device_id';
    const exists=d.prepare(`SELECT 1 FROM ${table} WHERE id=?`);
    for(const id of ids)if(!exists.get(id))bad(`授權標的 ${id} 不存在，請重新整理後再試。`);
    const duplicate=d.prepare(`SELECT 1 FROM grants WHERE grant_type=? AND ${column}=? AND email=? AND start=? AND end IS ? LIMIT 1`);
    const insert=d.prepare(`INSERT INTO grants(grant_type,${column},email,start,end) VALUES(?,?,?,?,?)`);
    let created=0,skipped=0;
    for(const id of ids){
      if(duplicate.get(grantType,id,email,start,end)){skipped++;continue;}
      insert.run(grantType,id,email,start,end);created++;
    }
    d.exec('COMMIT');return {created,skipped};
  }catch(error){d.exec('ROLLBACK');throw error;}
}

// Compare the reviewed rows inside the write transaction; never revoke a grant
// that changed owner, target or dates after the administrator selected it.
export function revokeBulkGrants(d,actor,{grants}={}){
  const fields=['grant_type','device_id','lab_id','email','start','end'];
  if(!Array.isArray(grants)||!grants.length||grants.length>10000||grants.some(row=>!row||!Number.isSafeInteger(row.id)||row.id<=0||fields.some(key=>!Object.hasOwn(row,key)||(row[key]!==null&&typeof row[key]!=='string')))||new Set(grants.map(row=>row.id)).size!==grants.length)
    throw new DataGrantError(400,'請選擇 1 至 10000 筆不重複的授權紀錄，並提供完整授權內容。');
  d.exec('BEGIN IMMEDIATE');
  try{
    const admin=d.prepare('SELECT role,active FROM members WHERE email=?').get(actor?.email);
    if(!admin?.active||admin.role!=='admin')throw new DataGrantError(403,'只有啟用中的系統管理員可以撤銷授權。');
    const read=d.prepare('SELECT * FROM grants WHERE id=?');
    for(const expected of grants){const current=read.get(expected.id);if(!current||fields.some(key=>(current[key]??null)!==expected[key]))throw new DataGrantError(409,'所選授權已變更或已撤銷，請重新整理後重新確認；本次未撤銷任何授權。');}
    const remove=d.prepare('DELETE FROM grants WHERE id=?');
    for(const row of grants)remove.run(row.id);
    d.exec('COMMIT');return {revoked:grants.length};
  }catch(error){d.exec('ROLLBACK');throw error;}
}
