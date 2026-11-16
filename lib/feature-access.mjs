import {randomUUID} from 'node:crypto';
import {FEATURES,roleFeatureAllowed} from './feature-options.mjs';
import {limitedJson} from './http-security.mjs';
export {HttpSecurityError} from './http-security.mjs';
export {FEATURES,roleFeatureAllowed};
export class FeatureAccessError extends Error{constructor(status,message){super(message);this.status=status;}}
const error=(status,message)=>{throw new FeatureAccessError(status,message);};
const ready=new WeakSet();
export function ensureFeatureAccessSchema(d){
 if(ready.has(d))return;
 d.exec(`CREATE TABLE IF NOT EXISTS file_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,revision INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS file_group_members(group_id TEXT NOT NULL REFERENCES file_groups(id) ON DELETE CASCADE,email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE ON UPDATE CASCADE,PRIMARY KEY(group_id,email));
 CREATE TABLE IF NOT EXISTS feature_policies(feature TEXT PRIMARY KEY,mode TEXT NOT NULL CHECK(mode IN ('role','selected')),revision INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS feature_members(feature TEXT NOT NULL REFERENCES feature_policies(feature) ON DELETE CASCADE,email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE ON UPDATE CASCADE,PRIMARY KEY(feature,email));
 CREATE TABLE IF NOT EXISTS feature_groups(feature TEXT NOT NULL REFERENCES feature_policies(feature) ON DELETE CASCADE,group_id TEXT NOT NULL REFERENCES file_groups(id) ON DELETE CASCADE,PRIMARY KEY(feature,group_id));
 CREATE TABLE IF NOT EXISTS feature_access_events(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,target TEXT NOT NULL,before_state TEXT NOT NULL,after_state TEXT NOT NULL,created_at TEXT NOT NULL);`);
 ready.add(d);
}
function live(d,actor){const m=d.prepare('SELECT email,role,active FROM members WHERE email=?').get(actor?.email);if(!m?.active)error(403,'帳號已停用或不存在。');return m;}
function admin(d,actor){const m=live(d,actor);if(m.role!=='admin')error(403,'只有系統管理員可以設定功能存取。');return m;}
function text(value,label,max=160){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))error(400,`${label}格式不正確。`);return value.trim();}
function rule(d,id){const row=d.prepare('SELECT * FROM feature_policies WHERE feature=?').get(id);return {feature:id,mode:row?.mode||'role',revision:row?.revision||0,emails:d.prepare('SELECT email FROM feature_members WHERE feature=? ORDER BY email').all(id).map(r=>r.email),group_ids:d.prepare('SELECT group_id FROM feature_groups WHERE feature=? ORDER BY group_id').all(id).map(r=>r.group_id)};}
export function featureAccess(d,actor){
 const m=live(d,actor),base=Object.fromEntries(FEATURES.map(f=>[f.id,roleFeatureAllowed(m.role,f.id)]));
 if(m.role==='admin'||!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='feature_policies'").get())return base;
 for(const policy of d.prepare("SELECT feature FROM feature_policies WHERE mode='selected'").all()){
   if(!base[policy.feature])continue;
   base[policy.feature]=!!d.prepare(`SELECT 1 FROM feature_members WHERE feature=? AND email=? UNION ALL SELECT 1 FROM feature_groups p JOIN file_group_members g ON g.group_id=p.group_id WHERE p.feature=? AND g.email=? LIMIT 1`).get(policy.feature,m.email,policy.feature,m.email);
 }
 return base;
}
export function assertFeature(d,actor,id){if(!featureAccess(d,actor)[id])error(403,'您尚未取得此功能的存取權限。');}
export function featureAdminState(d,actor,{preview_email}={}){
 ensureFeatureAccessSchema(d);admin(d,actor);
 return {features:FEATURES.map(f=>({...f,...rule(d,f.id)})),groups:d.prepare('SELECT * FROM file_groups ORDER BY name').all().map(g=>({...g,emails:d.prepare('SELECT email FROM file_group_members WHERE group_id=? ORDER BY email').all(g.id).map(r=>r.email)})),members:d.prepare('SELECT email,name,role,active FROM members ORDER BY email').all(),events:d.prepare('SELECT * FROM feature_access_events ORDER BY id DESC LIMIT 50').all(),...(preview_email?{preview:featureAccess(d,{email:preview_email})}:{})};
}
function tx(d,work){const name='feature_'+randomUUID().replaceAll('-','');d.exec('SAVEPOINT '+name);try{const result=work();d.exec('RELEASE '+name);return result;}catch(e){d.exec('ROLLBACK TO '+name);d.exec('RELEASE '+name);throw e;}}
function emails(d,values){if(!Array.isArray(values)||values.length>10000||values.some(v=>typeof v!=='string'))error(400,'會員名單格式不正確。');const rows=[...new Set(values.map(v=>v.trim().toLowerCase()))];const exists=d.prepare('SELECT 1 FROM members WHERE email=?');if(rows.some(v=>!exists.get(v)))error(400,'名單包含不存在的會員。');return rows;}
function event(d,actor,target,before,after){d.prepare('INSERT INTO feature_access_events(actor,target,before_state,after_state,created_at) VALUES(?,?,?,?,?)').run(actor.email,target,JSON.stringify(before),JSON.stringify(after),new Date().toISOString());}
export function saveFeaturePolicy(d,actor,p){
 ensureFeatureAccessSchema(d);return tx(d,()=>{admin(d,actor);if(!FEATURES.some(f=>f.id===p.feature)||!['role','selected'].includes(p.mode))error(400,'功能或存取模式不正確。');
 const before=rule(d,p.feature);if(!Number.isSafeInteger(p.revision)||p.revision!==before.revision)error(409,'設定已更新，請重新整理後再儲存。');
 const users=emails(d,p.emails),groups=p.group_ids;if(!Array.isArray(groups)||groups.length>1000||groups.some(g=>typeof g!=='string'||!d.prepare('SELECT 1 FROM file_groups WHERE id=?').get(g)))error(400,'群組名單不正確。');
 d.prepare('INSERT INTO feature_policies(feature,mode,revision) VALUES(?,?,1) ON CONFLICT(feature) DO UPDATE SET mode=excluded.mode,revision=revision+1').run(p.feature,p.mode);
 d.prepare('DELETE FROM feature_members WHERE feature=?').run(p.feature);d.prepare('DELETE FROM feature_groups WHERE feature=?').run(p.feature);
 for(const email of users)d.prepare('INSERT INTO feature_members VALUES(?,?)').run(p.feature,email);
 for(const group of new Set(groups))d.prepare('INSERT INTO feature_groups VALUES(?,?)').run(p.feature,group);
 const after=rule(d,p.feature);event(d,actor,p.feature,before,after);return {ok:true,...after};});
}
export function saveSharedGroup(d,actor,p){
 ensureFeatureAccessSchema(d);return tx(d,()=>{admin(d,actor);const id=p.id?text(p.id,'群組'):'group_'+randomUUID(),before=d.prepare('SELECT * FROM file_groups WHERE id=?').get(id);
 if(p.id&&(!before||(!(p.action==='groupDelete'&&p.revision===undefined)&&(!Number.isSafeInteger(p.revision)||p.revision!==before.revision))))error(409,'群組已更新，請重新整理。');
 const oldEmails=before?d.prepare('SELECT email FROM file_group_members WHERE group_id=? ORDER BY email').all(id).map(r=>r.email):[];
 if(p.action==='groupDelete'){if(!before)error(404,'群組不存在。');d.prepare('DELETE FROM file_groups WHERE id=?').run(id);event(d,actor,id,{...before,emails:oldEmails},null);return {ok:true};}
 const users=emails(d,p.emails),name=text(p.name,'群組名稱',120);
 if(before)d.prepare('UPDATE file_groups SET name=?,revision=revision+1 WHERE id=?').run(name,id);else d.prepare('INSERT INTO file_groups(id,name,created_by,created_at) VALUES(?,?,?,?)').run(id,name,actor.email,new Date().toISOString());
 d.prepare('DELETE FROM file_group_members WHERE group_id=?').run(id);for(const email of users)d.prepare('INSERT INTO file_group_members VALUES(?,?)').run(id,email);
 event(d,actor,id,before?{...before,emails:oldEmails}:null,{name,emails:users});return {ok:true,id};});
}
// The old role/resource checks remain authoritative after this additional gate.
export async function assertFeatureRequest(d,actor,r){
 if(actor.role==='admin')return;
 const access=featureAccess(d,actor),url=new URL(r.url),path=url.pathname;
 let feature=null;
 if(path==='/api/manage'){
   if(r.method==='GET'){const scope=url.searchParams.get('scope');if(scope&&scope!=='bootstrap'&&scope!=='full')feature=scope;}
   else if(r.method==='POST'){
     const p=await limitedJson(r.clone(),512*1024);
     const actions={requestGrant:'data',reviewGrantRequest:'permissions',tokenCreate:'connection',fileLink:'files',fileDelete:'files',fileGrantsUpdate:'files'};
     feature=actions[p?.action]||null;
   }
 }else if(path==='/api/posts'){
   const id=url.searchParams.get('id'),exists=d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='site_posts'").get();const kind=id?(exists?d.prepare('SELECT kind FROM site_posts WHERE id=?').get(id)?.kind:null):url.searchParams.get('kind')||'news';feature=kind==='article'?'articles':'news';
 }else if(path==='/api/posts/images'){
   const id=url.searchParams.get('id');
   if(r.method==='GET'&&id){const parents=d.prepare("SELECT p.kind FROM site_post_image_refs r JOIN site_posts p ON p.id=r.post_id WHERE r.image_id=? AND p.status='published'").all(id);if(!parents.some(p=>access[p.kind==='article'?'articles':'news']))error(403,'您尚未取得圖片所屬功能的存取權限。');}
 }else if(path==='/api/processing'&&r.method==='GET'&&url.searchParams.has('id')&&url.searchParams.get('detail')!=='1'){
   feature='data';
 }else{
   const routes=[['/api/realtime','realtime'],['/api/data','data'],['/api/files','files'],['/api/hobo','hobo'],['/api/personal','personal'],['/api/calibration','calibration'],['/api/processing','calibration'],['/api/maintenance','maintenance'],['/api/device-management','devices'],['/api/fleet','devices'],['/api/alerts','alerts'],['/api/my-maintained-devices','alerts'],['/api/member-access','members'],['/api/maintainer-links','members'],['/api/activity','activity'],['/api/homepage-settings','homepage'],['/api/feature-access','feature-access']];
   feature=routes.find(([prefix])=>path===prefix||path.startsWith(prefix+'/'))?.[1]||null;
 }
 if(feature&&Object.hasOwn(access,feature)&&!access[feature])error(403,'您尚未取得此功能的存取權限。');
 return access;
}
