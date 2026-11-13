import {randomUUID} from 'node:crypto';
import {unlinkSync} from 'node:fs';

export class FileAccessError extends Error{constructor(status,message){super(message);this.status=status;}}
const error=(status,message)=>{throw new FileAccessError(status,message);};
const ready=new WeakSet();let sequence=0;
export const FILE_RIGHTS=['view','download','manage','grant'];
export function ensureFileAccessSchema(d){
  if(ready.has(d))return;
  d.exec('SAVEPOINT file_access_schema');
  try{
    d.exec(`CREATE TABLE IF NOT EXISTS file_folders(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,revision INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
      INSERT OR IGNORE INTO file_folders(id,name,created_by,created_at) VALUES('root','未分類','system',datetime('now'));
      CREATE TABLE IF NOT EXISTS file_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,revision INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS file_group_members(group_id TEXT NOT NULL REFERENCES file_groups(id) ON DELETE CASCADE,email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE ON UPDATE CASCADE,PRIMARY KEY(group_id,email));
      CREATE INDEX IF NOT EXISTS file_group_member_email ON file_group_members(email,group_id);
      CREATE TABLE IF NOT EXISTS file_permissions(id TEXT PRIMARY KEY,
        file_id TEXT REFERENCES files(id) ON DELETE CASCADE,folder_id TEXT REFERENCES file_folders(id) ON DELETE CASCADE,
        user_email TEXT REFERENCES members(email) ON DELETE CASCADE ON UPDATE CASCADE,group_id TEXT REFERENCES file_groups(id) ON DELETE CASCADE,
        can_view INTEGER NOT NULL,can_download INTEGER NOT NULL,can_manage INTEGER NOT NULL,can_grant INTEGER NOT NULL,
        valid_from TEXT NOT NULL,valid_until TEXT,parent_id TEXT REFERENCES file_permissions(id) ON DELETE CASCADE,
        created_by TEXT NOT NULL,created_at TEXT NOT NULL,legacy_source_id INTEGER UNIQUE,
        CHECK((file_id IS NOT NULL)+(folder_id IS NOT NULL)=1),CHECK((user_email IS NOT NULL)+(group_id IS NOT NULL)=1),
        CHECK(can_view IN(0,1) AND can_download IN(0,1) AND can_manage IN(0,1) AND can_grant IN(0,1)));
      CREATE INDEX IF NOT EXISTS file_permissions_file ON file_permissions(file_id);
      CREATE INDEX IF NOT EXISTS file_permissions_folder ON file_permissions(folder_id);
      CREATE TABLE IF NOT EXISTS file_access_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    if(!d.prepare('PRAGMA table_info(files)').all().some(row=>row.name==='folder_id'))d.exec('ALTER TABLE files ADD COLUMN folder_id TEXT REFERENCES file_folders(id)');
    if(!d.prepare("SELECT 1 FROM file_access_state WHERE key='legacy_migrated'").get()){
      d.exec(`INSERT OR IGNORE INTO file_permissions(id,file_id,user_email,can_view,can_download,can_manage,can_grant,valid_from,created_by,created_at,legacy_source_id)
        SELECT 'legacy_'||id,file_id,email,1,1,0,0,'1970-01-01T00:00:00.000Z','system:migration',COALESCE(created_at,datetime('now')),id FROM file_grants;
        INSERT INTO file_access_state VALUES('legacy_migrated','1');`);
    }
    d.exec('RELEASE file_access_schema');ready.add(d);
  }catch(e){d.exec('ROLLBACK TO file_access_schema; RELEASE file_access_schema');throw e;}
}
function text(value,label,max=255){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))error(400,`${label}格式不正確。`);return value.trim();}
function optionalText(value,max=2000){if(value===undefined)return '';if(typeof value!=='string'||value.length>max)error(400,'說明內容過長。');return value.trim();}
function flags(input){
  if(!input||typeof input!=='object'||FILE_RIGHTS.some(key=>typeof input[key]!=='boolean'))error(400,'請提供四種權限的勾選狀態。');
  if(!FILE_RIGHTS.some(key=>input[key]))error(400,'請至少選擇一種權限。');
  return {view:input.view||input.download||input.manage||input.grant,download:input.download,manage:input.manage,grant:input.grant};
}
function instant(value,fallback){
  if(value===undefined||value===null||value==='')return fallback;
  if(typeof value!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))error(400,'授權時間須包含時區。');
  return new Date(value).toISOString();
}
function transaction(d,work){const name='file_write_'+sequence++;d.exec('SAVEPOINT '+name);try{const result=work();d.exec('RELEASE '+name);return result;}catch(e){d.exec('ROLLBACK TO '+name);d.exec('RELEASE '+name);throw e;}}
export function fileContext(d,actor,now=Date.now()){
  ensureFileAccessSchema(d);
  const members=new Map(d.prepare('SELECT email,role,active FROM members').all().map(row=>[row.email,row]));
  const me=members.get(actor?.email);if(!me||!me.active)error(403,'帳號不存在或已停用。');
  const groups=d.prepare('SELECT * FROM file_groups ORDER BY name').all(),memberships=d.prepare('SELECT * FROM file_group_members').all();
  const permissions=d.prepare('SELECT * FROM file_permissions').all(),byId=new Map(permissions.map(row=>[row.id,row]));
  const files=new Map(d.prepare('SELECT * FROM files ORDER BY created_at DESC,id DESC').all().map(row=>[row.id,row]));
  const folders=new Map(d.prepare('SELECT * FROM file_folders ORDER BY name').all().map(row=>[row.id,row]));
  const subject=(row,email)=>row.user_email===email||!!row.group_id&&memberships.some(link=>link.group_id===row.group_id&&link.email===email);
  const covers=(parent,child)=>parent.file_id?parent.file_id===child.file_id:parent.folder_id===(child.folder_id||files.get(child.file_id)?.folder_id||'root');
  const memo=new Map();
  const valid=(row,seen=new Set())=>{
    if(!row||seen.size>=16||seen.has(row.id))return false;if(memo.has(row.id))return memo.get(row.id);
    const start=Date.parse(row.valid_from),end=row.valid_until?Date.parse(row.valid_until):Infinity;
    let result=Number.isFinite(start)&&!Number.isNaN(end)&&start<=now&&now<end;
    if(result&&row.parent_id){
      const parent=byId.get(row.parent_id),issuer=members.get(row.created_by);seen.add(row.id);
      result=!!issuer?.active&&!!parent&&!!parent.can_grant&&subject(parent,issuer.email)&&covers(parent,row)&&
        FILE_RIGHTS.every(key=>!row['can_'+key]||!!parent['can_'+key])&&Date.parse(parent.valid_from)<=start&&
        (!parent.valid_until||end<=Date.parse(parent.valid_until))&&valid(parent,seen);
    }
    memo.set(row.id,result);return result;
  };
  const byFile=new Map(),byFolder=new Map();
  for(const row of permissions){const index=row.file_id?byFile:byFolder,key=row.file_id||row.folder_id;if(!index.has(key))index.set(key,[]);index.get(key).push(row);}
  const rowsFor=(type,id)=>type==='folder'?(byFolder.get(id)||[]):[...(byFile.get(id)||[]),...(byFolder.get(files.get(id)?.folder_id||'root')||[])];
  const effective=(type,id)=>{
    if(type==='file'?!files.has(id):!folders.has(id))error(404,'找不到檔案或資料夾。');
    if(me.role==='admin')return Object.fromEntries(FILE_RIGHTS.map(key=>[key,true]));
    const rows=rowsFor(type,id).filter(row=>subject(row,me.email)&&valid(row));
    return Object.fromEntries(FILE_RIGHTS.map(key=>[key,rows.some(row=>!!row['can_'+key])]));
  };
  return {me,now,files,folders,groups,memberships,members,permissions,subject,valid,rowsFor,effective};
}
export function requireFileRight(ctx,type,id,right){const rights=ctx.effective(type,id);if(!rights[right])error(403,`未取得${{view:'檢視',download:'下載',manage:'管理',grant:'授權'}[right]}權限。`);return rights;}
export const previewableFile=file=>!file.external_url&&['application/pdf','image/png','image/jpeg','image/gif','image/webp','text/plain','text/csv'].includes(String(file.mime_type||'').toLowerCase().split(';')[0].trim());
function metadata(file,rights){return {id:file.id,name:file.name,size:file.size,mime_type:file.mime_type,description:file.description,uploader_email:file.uploader_email,created_at:file.created_at,folder_id:file.folder_id||'root',download_count:file.download_count||0,external:!!file.external_url,previewable:previewableFile(file),permissions:rights};}
export function accessibleFileMetadata(d,actor){const ctx=fileContext(d,actor);return [...ctx.files.values()].flatMap(file=>{const rights=ctx.effective('file',file.id);return rights.view?[metadata(file,rights)]:[];});}
export function fileWorkspace(d,actor,{folder='root',q='',page=1}={}){
  const ctx=fileContext(d,actor);if(typeof q!=='string'||q.length>160||!Number.isSafeInteger(page)||page<1||page>10000)error(400,'檔案搜尋條件不正確。');
  const accessible=[...ctx.files.values()].flatMap(file=>{const rights=ctx.effective('file',file.id);return rights.view?[metadata(file,rights)]:[];});
  const folders=[...ctx.folders.values()].flatMap(row=>{const rights=ctx.effective('folder',row.id);return row.id==='root'||rights.view||accessible.some(file=>file.folder_id===row.id)?[{...row,permissions:rights}]:[];});
  if(!folders.some(row=>row.id===folder))error(404,'找不到可存取的資料夾。');
  const matches=accessible.filter(file=>file.folder_id===folder&&(!q.trim()||(file.name+' '+(file.description||'')).toLowerCase().includes(q.trim().toLowerCase())));
  const groups=ctx.groups.filter(group=>ctx.me.role==='admin'||ctx.memberships.some(row=>row.group_id===group.id&&row.email===ctx.me.email)).map(group=>({...group,...(ctx.me.role==='admin'?{emails:ctx.memberships.filter(row=>row.group_id===group.id).map(row=>row.email)}:{})}));
  return {files:matches.slice((page-1)*50,page*50),total:matches.length,page,pages:Math.ceil(matches.length/50),folders,folder,groups,isAdmin:ctx.me.role==='admin',members:ctx.me.role==='admin'?[...ctx.members.values()].map(row=>({email:row.email,active:row.active})):[]};
}
export function filePermissionList(d,actor,type,id){
  if(!['file','folder'].includes(type))error(400,'授權對象類型不正確。');
  const ctx=fileContext(d,actor);requireFileRight(ctx,type,id,'grant');
  return {permissions:ctx.rowsFor(type,id).map(row=>({...row,active:ctx.valid(row),inherited:type==='file'&&!!row.folder_id,canRevoke:ctx.me.role==='admin'||row.created_by===ctx.me.email&&!!row.parent_id&&ctx.effective(row.file_id?'file':'folder',row.file_id||row.folder_id).grant})),groups:ctx.groups.filter(group=>ctx.me.role==='admin'||ctx.memberships.some(link=>link.email===ctx.me.email&&link.group_id===group.id))};
}
export function fileManagementAction(d,actor,input){
  if(!input||typeof input!=='object'||Array.isArray(input))error(400,'檔案管理內容格式不正確。');
  ensureFileAccessSchema(d);
  return transaction(d,()=>{
    const ctx=fileContext(d,actor),now=new Date(ctx.now).toISOString(),action=input.action;
    if(action==='folderSave'){
      if(input.id){
        const id=text(input.id,'資料夾');if(!Number.isSafeInteger(input.revision)||input.revision<1)error(400,'請提供資料夾版本。');if(id==='root')error(400,'未分類資料夾不可更名。');requireFileRight(ctx,'folder',id,'manage');
        if(!d.prepare('UPDATE file_folders SET name=?,revision=revision+1 WHERE id=? AND revision=?').run(text(input.name,'資料夾名稱',120),id,input.revision).changes)error(409,'資料夾已更新，請重新載入。');return {ok:true,id};
      }
      if(ctx.me.role!=='admin')error(403,'只有管理員可以建立資料夾。');const id='folder_'+randomUUID();d.prepare('INSERT INTO file_folders(id,name,created_by,created_at) VALUES(?,?,?,?)').run(id,text(input.name,'資料夾名稱',120),ctx.me.email,now);return {ok:true,id};
    }
    if(action==='folderDelete'){
      if(ctx.me.role!=='admin')error(403,'只有管理員可以刪除資料夾。');if(input.id==='root')error(400,'不可刪除未分類資料夾。');
      if([...ctx.files.values()].some(file=>(file.folder_id||'root')===input.id))error(409,'資料夾仍有檔案，請先移動或刪除檔案。');
      if(!d.prepare('DELETE FROM file_folders WHERE id=?').run(text(input.id,'資料夾')).changes)error(404,'找不到資料夾。');return {ok:true};
    }
    if(action==='groupSave'||action==='groupDelete'){
      if(ctx.me.role!=='admin')error(403,'只有管理員可以管理會員群組。');
      if(action==='groupDelete'){if(!d.prepare('DELETE FROM file_groups WHERE id=?').run(text(input.id,'群組')).changes)error(404,'找不到群組。');return {ok:true};}
      if(!Array.isArray(input.emails)||input.emails.length>1000||input.emails.some(email=>typeof email!=='string'))error(400,'群組會員名單不正確。');
      const emails=[...new Set(input.emails.map(email=>email.trim().toLowerCase()))];if(emails.some(email=>!ctx.members.has(email)))error(400,'群組包含不存在的會員。');
      const id=input.id?text(input.id,'群組'):'group_'+randomUUID(),name=text(input.name,'群組名稱',120);
      if(input.id&&(!Number.isSafeInteger(input.revision)||input.revision<1))error(400,'請提供群組版本。');
      if(input.id){if(!d.prepare('UPDATE file_groups SET name=?,revision=revision+1 WHERE id=? AND revision=?').run(name,id,input.revision).changes)error(409,'群組已更新，請重新載入。');}
      else d.prepare('INSERT INTO file_groups(id,name,created_by,created_at) VALUES(?,?,?,?)').run(id,name,ctx.me.email,now);
      d.prepare('DELETE FROM file_group_members WHERE group_id=?').run(id);for(const email of emails)d.prepare('INSERT INTO file_group_members VALUES(?,?)').run(id,email);return {ok:true,id};
    }
    if(action==='permissionSave'){
      const type=input.resource_type,id=text(input.resource_id,'授權對象');if(!['file','folder'].includes(type))error(400,'授權對象類型不正確。');requireFileRight(ctx,type,id,'grant');
      const rights=flags(input.permissions),start=instant(input.valid_from,now),end=instant(input.valid_until,null);
      if(end&&(end<=start||Date.parse(end)<=ctx.now))error(400,'到期時間須晚於生效時間與現在。');
      let email=null,group=null;
      if(input.subject_type==='user'){email=text(input.subject_id,'會員 Email',254).toLowerCase();if(!ctx.members.has(email))error(400,'找不到會員。');}
      else if(input.subject_type==='group'){group=text(input.subject_id,'群組');if(!ctx.groups.some(row=>row.id===group))error(400,'找不到群組。');if(ctx.me.role!=='admin'&&!ctx.memberships.some(row=>row.email===ctx.me.email&&row.group_id===group))error(403,'只能選擇所屬群組。');}
      else error(400,'請選擇會員或群組。');
      let parent=null;
      if(ctx.me.role!=='admin'){
        parent=ctx.rowsFor(type,id).find(row=>row.can_grant&&ctx.subject(row,ctx.me.email)&&ctx.valid(row)&&FILE_RIGHTS.every(key=>!rights[key]||row['can_'+key])&&row.valid_from<=start&&(!row.valid_until||!!end&&end<=row.valid_until));
        if(!parent)error(403,'轉授權限或期間超過可轉授範圍；請縮小範圍或聯絡管理員。');
      }
      const permissionId='permission_'+randomUUID();
      d.prepare(`INSERT INTO file_permissions(id,file_id,folder_id,user_email,group_id,can_view,can_download,can_manage,can_grant,valid_from,valid_until,parent_id,created_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(permissionId,type==='file'?id:null,type==='folder'?id:null,email,group,...FILE_RIGHTS.map(key=>+rights[key]),start,end,parent?.id||null,ctx.me.email,now);return {ok:true,id:permissionId};
    }
    if(action==='permissionDelete'){
      const row=ctx.permissions.find(row=>row.id===input.id);if(!row)error(404,'找不到授權。');requireFileRight(ctx,row.file_id?'file':'folder',row.file_id||row.folder_id,'grant');
      if(ctx.me.role!=='admin'&&(!row.parent_id||row.created_by!==ctx.me.email))error(403,'只能撤銷由自己轉授的授權。');d.prepare('DELETE FROM file_permissions WHERE id=?').run(row.id);
      if(row.legacy_source_id!=null)d.prepare('DELETE FROM file_grants WHERE id=?').run(row.legacy_source_id);return {ok:true};
    }
    if(action==='fileUpdate'){
      const id=text(input.id,'檔案');requireFileRight(ctx,'file',id,'manage');const old=ctx.files.get(id),folder=input.folder_id||old.folder_id||'root';
      if(folder!==(old.folder_id||'root')&&ctx.me.role!=='admin')error(403,'跨資料夾移動會改變繼承授權，只能由管理員執行。');
      if(!ctx.folders.has(folder))error(400,'找不到目的資料夾。');d.prepare('UPDATE files SET name=?,description=?,folder_id=? WHERE id=?').run(text(input.name,'檔案名稱'),optionalText(input.description),folder,id);return {ok:true};
    }
    error(400,'不支援的檔案管理操作。');
  });
}
export function addLegacyFileGrants(d,fileId,emails,actor){
  ensureFileAccessSchema(d);const ctx=fileContext(d,actor);requireFileRight(ctx,'file',fileId,'grant');
  if(ctx.me.role!=='admin')error(403,'請使用有期限的轉授設定。');
  if(!Array.isArray(emails)||emails.length>1000||emails.some(email=>typeof email!=='string'))error(400,'會員名單格式不正確。');
  const normalized=[...new Set(emails.map(email=>email.trim().toLowerCase()))];if(normalized.some(email=>!ctx.members.has(email)))error(400,'會員名單包含不存在的會員。');
  for(const email of normalized){
    d.prepare('INSERT OR IGNORE INTO file_grants(file_id,email,created_at) VALUES(?,?,?)').run(fileId,email,new Date().toISOString());
    const grant=d.prepare('SELECT id,created_at FROM file_grants WHERE file_id=? AND email=?').get(fileId,email);
    d.prepare(`INSERT OR IGNORE INTO file_permissions(id,file_id,user_email,can_view,can_download,can_manage,can_grant,valid_from,created_by,created_at,legacy_source_id) VALUES(?,?,?,1,1,0,0,'1970-01-01T00:00:00.000Z',?,?,?)`).run('legacy_'+grant.id,fileId,email,ctx.me.email,grant.created_at,grant.id);
  }
}
export function replaceLegacyFileGrants(d,actor,fileId,emails){
  ensureFileAccessSchema(d);return transaction(d,()=>{const ctx=fileContext(d,actor);if(ctx.me.role!=='admin')error(403,'只有管理員可以更新舊版會員授權。');requireFileRight(ctx,'file',fileId,'grant');d.prepare('DELETE FROM file_permissions WHERE file_id=? AND legacy_source_id IS NOT NULL').run(fileId);d.prepare('DELETE FROM file_grants WHERE file_id=?').run(fileId);addLegacyFileGrants(d,fileId,emails,actor);return {ok:true};});
}
export function deleteManagedFile(d,actor,id){
  ensureFileAccessSchema(d);let file;
  const result=transaction(d,()=>{const ctx=fileContext(d,actor);requireFileRight(ctx,'file',id,'manage');file=ctx.files.get(id);d.prepare('DELETE FROM files WHERE id=?').run(id);return {ok:true};});
  if(file.storage_path&&!file.external_url)try{unlinkSync(file.storage_path);}catch{/* A private orphan is safer than deleting bytes before a failed DB commit. */}
  return result;
}
export function withFileWrite(d,actor,folder,work){ensureFileAccessSchema(d);return transaction(d,()=>{const ctx=fileContext(d,actor);requireFileRight(ctx,'folder',folder,'manage');return work(ctx);});}
