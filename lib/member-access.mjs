import {validMemberRole} from './permissions.mjs';
export class AccessError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export function ensureMemberAccessSchema(d){
  const sql=d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='members'").get()?.sql;
  // Rebuild only the old two-role CHECK, retaining all columns and dependent rows.
  if(sql&&/CHECK\s*\(\s*role\s+IN\s*\(\s*'admin'\s*,\s*'member'\s*\)\s*\)/i.test(sql)){
    if(d.isTransaction)throw new AccessError('會員角色資料庫升級必須在獨立交易執行。',500);
    d.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try{
      const current=d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='members'").get().sql;
      if(!current.includes('device_manager')){
        const objects=d.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='members' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
        const create=current.replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`\[]?members["`\]]?/i,'CREATE TABLE members_roles_upgrade')
          .replace(/CHECK\s*\(\s*role\s+IN\s*\(\s*'admin'\s*,\s*'member'\s*\)\s*\)/i,"CHECK(role IN ('admin','member','device_manager','calibration_manager','viewer'))");
        const columns=d.prepare('PRAGMA table_info(members)').all().map(c=>'"'+c.name.replaceAll('"','""')+'"').join(',');
        d.exec(create);d.exec(`INSERT INTO members_roles_upgrade(${columns}) SELECT ${columns} FROM members`);
        d.exec('DROP TABLE members; ALTER TABLE members_roles_upgrade RENAME TO members');
        for(const object of objects)d.exec(object.sql);
        if(d.prepare('PRAGMA foreign_key_check').all().length)throw new AccessError('會員升級的關聯驗證失敗，已取消升級。',500);
      }
      d.exec('COMMIT');
    }catch(e){d.exec('ROLLBACK');throw e;}
    finally{d.exec('PRAGMA foreign_keys=ON');}
  }
  d.exec(`CREATE TABLE IF NOT EXISTS member_device_scopes(
    email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE ON UPDATE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    updated_by TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(email,device_id));
    CREATE TABLE IF NOT EXISTS member_access_events(id INTEGER PRIMARY KEY,target_email TEXT NOT NULL,
    before_state TEXT NOT NULL,after_state TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);`);
}
export function managedDeviceIds(d,me){
  if(me.role==='admin')return new Set(d.prepare('SELECT id FROM devices').all().map(r=>r.id));
  if(me.role!=='device_manager')return new Set();
  // Called from isolated maintenance helpers too, whose stores may predate this schema.
  if(!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='member_device_scopes'").get())return new Set();
  return new Set(d.prepare("SELECT s.device_id FROM member_device_scopes s JOIN members m ON m.email=s.email WHERE lower(s.email)=? AND m.active=1 AND m.role='device_manager'").all(me.email.toLowerCase()).map(r=>r.device_id));
}
export function assertManagedDevice(d,me,id){
  const current=d.prepare('SELECT role,active FROM members WHERE email=?').get(me.email);
  if(!current?.active||!['admin','device_manager'].includes(current.role)||!managedDeviceIds(d,{...me,role:current.role}).has(id))throw new AccessError('此設備不在您的管理範圍內。',403);
}
export function saveMemberAccess(d,actor,p){
  if(actor.role!=='admin')throw new AccessError('只有系統管理員可以設定會員權限。',403);
  if(typeof p.email!=='string'||!validMemberRole(p.role)||!Array.isArray(p.device_ids)||p.device_ids.length>10000||p.device_ids.some(id=>typeof id!=='string'||!id||id.length>80))throw new AccessError('請提供正確的角色及設備管理範圍。');
  ensureMemberAccessSchema(d);const email=p.email.toLowerCase(),ids=[...new Set(p.device_ids)];
  if(email===actor.email.toLowerCase())throw new AccessError('無法修改自己的角色與管理範圍。');
  if(p.role!=='device_manager'&&ids.length)throw new AccessError('僅設備管理員可設定設備管理範圍。');
  d.exec('BEGIN IMMEDIATE');try{
    const liveActor=d.prepare('SELECT role,active FROM members WHERE lower(email)=?').get(actor.email.toLowerCase());
    if(!liveActor?.active||liveActor.role!=='admin')throw new AccessError('系統管理權限已變更，請重新登入。',403);
    const member=d.prepare('SELECT role FROM members WHERE email=?').get(email);if(!member)throw new AccessError('會員不存在。',404);
    const profile=d.prepare('SELECT registration_status FROM member_profiles WHERE email=?').get(email);
    if(profile&&profile.registration_status!=='approved')throw new AccessError('請先完成 Email 驗證與帳號審核。');
    if(member.role==='admin'&&p.role!=='admin'&&d.prepare("SELECT COUNT(*) n FROM members WHERE role='admin' AND active=1").get().n<=1)throw new AccessError('至少需要保留一位啟用中的系統管理員。');
    const before={role:member.role,device_ids:d.prepare('SELECT device_id FROM member_device_scopes WHERE email=? ORDER BY device_id').all(email).map(r=>r.device_id)};
    for(const id of ids)if(!d.prepare('SELECT 1 FROM devices WHERE id=?').get(id))throw new AccessError(`設備不存在：${id}`);
    d.prepare('UPDATE members SET role=? WHERE email=?').run(p.role,email);
    d.prepare('DELETE FROM member_device_scopes WHERE email=?').run(email);
    const now=new Date().toISOString(),insert=d.prepare('INSERT INTO member_device_scopes(email,device_id,updated_by,updated_at) VALUES(?,?,?,?)');
    for(const id of ids)insert.run(email,id,actor.email,now);
    d.prepare('INSERT INTO member_access_events(target_email,before_state,after_state,actor,created_at) VALUES(?,?,?,?,?)').run(email,JSON.stringify(before),JSON.stringify({role:p.role,device_ids:ids.sort()}),actor.email,now);
    // Existing data grants are deliberately untouched.
    d.exec('COMMIT');return {ok:true};
  }catch(e){d.exec('ROLLBACK');throw e;}
}
