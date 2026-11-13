import {ensureFileAccessSchema,withFileWrite,addLegacyFileGrants} from './file-access.mjs';
import {randomUUID} from 'node:crypto';
export class FileLinkError extends Error {constructor(status,message){super(message);this.status=status;}}
export function externalFileUrl(value){
  if(typeof value!=='string'||!value.trim()||value.length>4096||/[\u0000-\u0020\u007f]/.test(value.trim()))throw new FileLinkError(400,'請提供完整的 http 或 https 下載網址（最多 4096 字）。');
  let url;try{url=new URL(value.trim());}catch{throw new FileLinkError(400,'外部下載網址格式不正確。');}
  if(!['https:','http:'].includes(url.protocol)||!url.hostname||url.username||url.password)throw new FileLinkError(400,'外部連結僅接受 http／https，且不可在網址內夾帶登入帳密。');
  return url.href;
}
export function ensureFileLinksSchema(d){
  d.exec('BEGIN IMMEDIATE');
  try{
    if(!d.prepare('PRAGMA table_info(files)').all().some(column=>column.name==='external_url'))d.exec('ALTER TABLE files ADD COLUMN external_url TEXT');
    d.exec('COMMIT');
  }catch(e){d.exec('ROLLBACK');throw e;}
}
export function createFileLink(d,actor,input){
  const url=externalFileUrl(input.url);
  if(typeof input.name!=='string'||!input.name.trim()||input.name.length>255)throw new FileLinkError(400,'請填寫檔案名稱（最多 255 字）。');
  const description=input.description??'';
  if(typeof description!=='string'||description.length>2000)throw new FileLinkError(400,'說明最多 2000 字。');
  input={...input,emails:input.emails??[]};
  if(!Array.isArray(input.emails)||input.emails.length>1000||input.emails.some(email=>typeof email!=='string'))throw new FileLinkError(400,'授權成員名單格式不正確。');
  const emails=[...new Set(input.emails.map(email=>email.trim().toLowerCase()))];
  ensureFileLinksSchema(d);
  ensureFileAccessSchema(d);
  const folder=input.folder_id||'root';
  const id='f_'+randomUUID().replaceAll('-','').slice(0,16),now=new Date().toISOString();
  return withFileWrite(d,actor,folder,()=>{
    for(const email of emails)if(!email||!d.prepare('SELECT 1 FROM members WHERE email=?').get(email))throw new FileLinkError(400,'授權名單包含不存在的會員，請重新選擇。');
    d.prepare(`INSERT INTO files(id,name,size,mime_type,description,uploader_email,storage_path,created_at,external_url)
      VALUES(?,?,0,'application/x-external-link',?,?,'',?,?)`).run(id,input.name.trim(),description.trim(),actor.email,now,url);
    d.prepare('UPDATE files SET folder_id=? WHERE id=?').run(folder,id);
    if(emails.length)addLegacyFileGrants(d,id,emails,actor);
    return {ok:true,fileId:id};
  });
}
