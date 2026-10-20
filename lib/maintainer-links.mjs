import {alertEmailExclusion} from './alert-policy.mjs';
export class MaintainerLinkError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export function ensureMaintainerLinkSchema(d){
  const columns=d.prepare('PRAGMA table_info(maintainers)').all();
  if(!columns.length)return;
  const own=!d.isTransaction;if(own)d.exec('BEGIN IMMEDIATE');
  try{
    if(!d.prepare('PRAGMA table_info(maintainers)').all().some(c=>c.name==='maintainer_id'))d.exec('ALTER TABLE maintainers ADD COLUMN maintainer_id TEXT');
    d.exec(`UPDATE maintainers SET maintainer_id=lower(hex(randomblob(16))) WHERE maintainer_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS maintainers_stable_id ON maintainers(maintainer_id);
      CREATE TABLE IF NOT EXISTS member_maintainer_links(
      member_user_id TEXT NOT NULL REFERENCES members(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
      maintainer_id TEXT NOT NULL REFERENCES maintainers(maintainer_id) ON DELETE CASCADE,
      linked_by TEXT NOT NULL,linked_at TEXT NOT NULL,PRIMARY KEY(member_user_id,maintainer_id));
      CREATE TABLE IF NOT EXISTS member_maintainer_link_state(member_user_id TEXT PRIMARY KEY REFERENCES members(user_id) ON DELETE CASCADE ON UPDATE CASCADE,revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS maintainer_link_routing(maintainer_id TEXT PRIMARY KEY REFERENCES maintainers(maintainer_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS member_maintainer_link_events(id INTEGER PRIMARY KEY,target_user_id TEXT NOT NULL,before_ids TEXT NOT NULL,after_ids TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);`);
    const locations=d.prepare('PRAGMA table_info(device_locations)').all();
    if(locations.length){
      if(!locations.some(c=>c.name==='maintainer_id'))d.exec('ALTER TABLE device_locations ADD COLUMN maintainer_id TEXT REFERENCES maintainers(maintainer_id) ON DELETE SET NULL');
      d.exec(`UPDATE device_locations SET maintainer_id=(SELECT m.maintainer_id FROM maintainers m WHERE trim(m.name)=trim(device_locations.maintainer)) WHERE maintainer_id IS NULL;
        CREATE TRIGGER IF NOT EXISTS location_maintainer_identity_insert AFTER INSERT ON device_locations BEGIN
          UPDATE device_locations SET maintainer_id=(SELECT maintainer_id FROM maintainers WHERE trim(name)=trim(NEW.maintainer)) WHERE rowid=NEW.rowid; END;
        CREATE TRIGGER IF NOT EXISTS location_maintainer_identity_update AFTER UPDATE OF maintainer ON device_locations WHEN NEW.maintainer IS NOT OLD.maintainer BEGIN
          UPDATE device_locations SET maintainer_id=(SELECT maintainer_id FROM maintainers WHERE trim(name)=trim(NEW.maintainer)) WHERE rowid=NEW.rowid; END;`);
    }
    d.exec(`CREATE TRIGGER IF NOT EXISTS maintainer_stable_identity_insert AFTER INSERT ON maintainers WHEN NEW.maintainer_id IS NULL BEGIN
      UPDATE maintainers SET maintainer_id=lower(hex(randomblob(16))) WHERE rowid=NEW.rowid; END;`);
    // ID assignment also resolves locations imported before the maintainer list.
    if(locations.length)d.exec(`CREATE TRIGGER IF NOT EXISTS maintainer_resolve_locations AFTER UPDATE OF maintainer_id ON maintainers WHEN NEW.maintainer_id IS NOT NULL BEGIN
      UPDATE device_locations SET maintainer_id=NEW.maintainer_id WHERE maintainer_id IS NULL AND trim(maintainer)=trim(NEW.name); END;
      CREATE TRIGGER IF NOT EXISTS maintainer_display_rename AFTER UPDATE OF name ON maintainers WHEN NEW.name IS NOT OLD.name BEGIN
      UPDATE device_locations SET maintainer=NEW.name WHERE maintainer_id=NEW.maintainer_id; END;`);
    if(own)d.exec('COMMIT');
  }catch(e){if(own)d.exec('ROLLBACK');throw e;}
}
function liveMember(d,me){
  const member=d.prepare('SELECT * FROM members WHERE lower(email)=?').get(String(me.email||'').toLowerCase());
  if(!member?.active||!member.user_id||(me.user_id&&me.user_id!==member.user_id))throw new MaintainerLinkError('會員身分已變更，請重新登入。',403);
  return member;
}
export function maintainerLinkDetails(d,actor,email){
  ensureMaintainerLinkSchema(d);const admin=liveMember(d,actor);
  if(admin.role!=='admin')throw new MaintainerLinkError('只有管理員可以設定維護身分關聯。',403);
  const member=d.prepare('SELECT user_id,email,name FROM members WHERE lower(email)=?').get(String(email).toLowerCase());
  if(!member)throw new MaintainerLinkError('會員不存在。',404);
  const maintainers=d.prepare("SELECT maintainer_id,name,english_name,email FROM maintainers ORDER BY name").all();
  return {member,maintainers,linked_ids:d.prepare('SELECT maintainer_id FROM member_maintainer_links WHERE member_user_id=?').all(member.user_id).map(r=>r.maintainer_id),
    suggested_ids:maintainers.filter(m=>String(m.email||'').trim().toLowerCase()===member.email.toLowerCase()).map(m=>m.maintainer_id),
    revision:d.prepare('SELECT revision FROM member_maintainer_link_state WHERE member_user_id=?').get(member.user_id)?.revision||0,
    events:d.prepare('SELECT * FROM member_maintainer_link_events WHERE target_user_id=? ORDER BY id DESC LIMIT 20').all(member.user_id)};
}
export function saveMaintainerLinks(d,actor,p){
  ensureMaintainerLinkSchema(d);
  if(!p||typeof p.email!=='string'||!Array.isArray(p.maintainer_ids)||p.maintainer_ids.length>1000||p.maintainer_ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))||!Number.isSafeInteger(p.revision)||p.revision<0)throw new MaintainerLinkError('維護身分關聯資料不正確。');
  d.exec('BEGIN IMMEDIATE');try{
    const admin=liveMember(d,actor);if(admin.role!=='admin')throw new MaintainerLinkError('只有管理員可以設定維護身分關聯。',403);
    const member=d.prepare('SELECT user_id FROM members WHERE lower(email)=?').get(p.email.toLowerCase());if(!member?.user_id)throw new MaintainerLinkError('會員不存在或缺少固定識別碼。',404);
    if(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='member_profiles'").get()){
      const profile=d.prepare('SELECT registration_status FROM member_profiles WHERE lower(email)=?').get(p.email.toLowerCase());
      if(profile&&profile.registration_status!=='approved')throw new MaintainerLinkError('請先完成會員審核。');
    }
    const revision=d.prepare('SELECT revision FROM member_maintainer_link_state WHERE member_user_id=?').get(member.user_id)?.revision||0;
    if(revision!==p.revision)throw new MaintainerLinkError('關聯已被其他管理員更新，請重新開啟設定。',409);
    const ids=[...new Set(p.maintainer_ids)].sort();for(const id of ids)if(!d.prepare('SELECT 1 FROM maintainers WHERE maintainer_id=?').get(id))throw new MaintainerLinkError('維護人員已不存在，請重新載入。');
    const before=d.prepare('SELECT maintainer_id FROM member_maintainer_links WHERE member_user_id=? ORDER BY maintainer_id').all(member.user_id).map(r=>r.maintainer_id),now=new Date().toISOString();
    d.prepare('DELETE FROM member_maintainer_links WHERE member_user_id=?').run(member.user_id);
    for(const id of ids)d.prepare('INSERT INTO member_maintainer_links VALUES(?,?,?,?)').run(member.user_id,id,admin.email,now);
    for(const id of new Set([...before,...ids]))d.prepare('INSERT OR IGNORE INTO maintainer_link_routing VALUES(?)').run(id);
    d.prepare('INSERT INTO member_maintainer_link_state VALUES(?,?) ON CONFLICT(member_user_id) DO UPDATE SET revision=excluded.revision').run(member.user_id,revision+1);
    d.prepare('INSERT INTO member_maintainer_link_events(target_user_id,before_ids,after_ids,actor,created_at) VALUES(?,?,?,?,?)').run(member.user_id,JSON.stringify(before),JSON.stringify(ids),admin.email,now);
    d.exec('COMMIT');return {ok:true};
  }catch(e){d.exec('ROLLBACK');throw e;}
}
function locationTime(value,fallback){
  if(!value)return fallback;let s=String(value).trim().replace(' ','T');
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))s+='T00:00:00';
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(s)?s:s+'+08:00');
}
export function myMaintainedDevices(d,me,now=new Date()){
  ensureMaintainerLinkSchema(d);const member=liveMember(d,me);
  const identities=d.prepare(`SELECT m.maintainer_id,m.name,m.english_name FROM maintainers m JOIN member_maintainer_links l ON l.maintainer_id=m.maintainer_id WHERE l.member_user_id=? ORDER BY m.name`).all(member.user_id);
  const linked=new Set(identities.map(m=>m.maintainer_id));if(!linked.size)return {identities,devices:[],alert_email_enabled:member.alert_email_enabled!==0};
  const locations=d.prepare(`SELECT dl.*,d.status AS device_status,m.name AS maintainer_name,m.english_name FROM device_locations dl JOIN devices d ON d.id=dl.aslung_id LEFT JOIN maintainers m ON m.maintainer_id=dl.maintainer_id WHERE dl.active=1`).all()
    .filter(r=>locationTime(r.start_time,-Infinity)<=now.getTime()&&locationTime(r.end_time,Infinity)>now.getTime())
    .sort((a,b)=>locationTime(b.start_time,-Infinity)-locationTime(a.start_time,-Infinity)||b.id-a.id);
  const latest=new Map();for(const r of locations)if(!latest.has(r.aslung_id))latest.set(r.aslung_id,r);
  return {identities,alert_email_enabled:member.alert_email_enabled!==0,devices:[...latest.values()].filter(r=>linked.has(r.maintainer_id)).map(r=>({id:r.aslung_id,lab_id:r.lab_id,maintainer_id:r.maintainer_id,maintainer:r.maintainer_name,english_name:r.english_name,start:r.start_time})).sort((a,b)=>a.id.localeCompare(b.id))};
}
export function connectionStatus(lastSeen,threshold,now=new Date()){
  if(!lastSeen)return {status:'NO_DATA',last_seen:null,offline_mins:null,email_exclusion:alertEmailExclusion(null,now)};
  const time=new Date(lastSeen),age=now.getTime()-time.getTime();
  if(!Number.isFinite(age)||age<0)return {status:'UNKNOWN',last_seen:null,offline_mins:null,email_exclusion:'最後回報時間無效'};
  return {status:age>threshold*60000?'OFFLINE':'ONLINE',last_seen:time.toISOString(),offline_mins:Math.floor(age/60000),email_exclusion:alertEmailExclusion(time,now)};
}
// Null means no explicit links: preserve the legacy maintainer email route.
// An empty array means linked accounts are inactive/opted out: never fall back.
export async function explicitAlertRecipients(store,maintainer){
  if(!maintainer?.maintainer_id)return null;
  const rows=(await store.prepare(`SELECT m.email,m.active,m.alert_email_enabled FROM member_maintainer_links l JOIN members m ON m.user_id=l.member_user_id WHERE l.maintainer_id=?`).bind(maintainer.maintainer_id).all()).results;
  if(!rows.length)return await store.prepare('SELECT 1 FROM maintainer_link_routing WHERE maintainer_id=?').bind(maintainer.maintainer_id).first()?[]:null;
  return [...new Set(rows.filter(m=>m.active===1&&m.alert_email_enabled!==0&&!String(m.email).toLowerCase().endsWith('@local.aslung')).map(m=>m.email))];
}
