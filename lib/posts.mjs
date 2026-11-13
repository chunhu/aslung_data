import {normalizePostDocument,PostDocumentError} from './post-document.mjs';
import {randomUUID} from 'node:crypto';

export class PostError extends Error {constructor(status,message){super(message);this.status=status;}}
const kinds=['news','article'],statuses=['draft','published','archived'];
const publicFields='id,kind,title,summary,status,pinned,author_name,created_at,updated_at,published_at,version';
const error=(status,message)=>{throw new PostError(status,message);};
function signedIn(actor){if(!actor?.email)error(401,'請先登入。');}
function admin(actor){signedIn(actor);if(actor.role!=='admin')error(403,'只有系統管理員可以發布或管理內容。');}
function text(value,name,max,required=true){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))error(400,`${name}請填寫完整，最多 ${max} 字。`);return value.trim();}
function kind(value){if(!kinds.includes(value))error(400,'內容類型不正確。');return value;}
function postId(value){if(typeof value!=='string'||!/^[a-f0-9-]{36}$/.test(value))error(400,'貼文識別碼不正確。');return value;}
const ready=new WeakSet();
export function ensurePostSchema(d){
  if(ready.has(d))return;
  d.exec(`CREATE TABLE IF NOT EXISTS site_posts(
    id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('news','article')),
    title TEXT NOT NULL,summary TEXT NOT NULL,body TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),pinned INTEGER NOT NULL DEFAULT 0,
    author_name TEXT NOT NULL,created_by TEXT NOT NULL,updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,published_at TEXT,version INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS site_posts_feed ON site_posts(kind,status,pinned,published_at);
    CREATE TABLE IF NOT EXISTS site_post_events(id INTEGER PRIMARY KEY AUTOINCREMENT,post_id TEXT NOT NULL,
      actor TEXT NOT NULL,action TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL);`);
  if(!d.prepare('PRAGMA table_info(site_posts)').all().some(row=>row.name==='body_json'))d.exec('ALTER TABLE site_posts ADD COLUMN body_json TEXT');
  d.exec(`CREATE TABLE IF NOT EXISTS site_post_images(id TEXT PRIMARY KEY,data BLOB NOT NULL,mime_type TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS site_post_images_uploader ON site_post_images(created_by,created_at);
    CREATE TABLE IF NOT EXISTS site_post_image_refs(post_id TEXT NOT NULL REFERENCES site_posts(id) ON DELETE CASCADE,image_id TEXT NOT NULL REFERENCES site_post_images(id),PRIMARY KEY(post_id,image_id));
    CREATE INDEX IF NOT EXISTS site_post_image_lookup ON site_post_image_refs(image_id,post_id);`);
  ready.add(d);
}
export function listPosts(d,actor,{type='news',manage=false,status='all',q='',page=1}={}){
  signedIn(actor);if(manage)admin(actor);ensurePostSchema(d);kind(type);
  q=text(q,'搜尋文字',160,false);page=Number(page);
  if(!Number.isSafeInteger(page)||page<1||page>100000)error(400,'頁碼不正確。');
  const where=['kind=?'],args=[type];
  if(!manage){where.push("status='published'");}else if(status!=='all'){
    if(!statuses.includes(status))error(400,'發布狀態不正確。');where.push('status=?');args.push(status);
  }
  if(q){where.push('(instr(lower(title),lower(?))>0 OR instr(lower(summary),lower(?))>0 OR instr(lower(body),lower(?))>0)');args.push(q,q,q);}
  const condition=where.join(' AND '),total=d.prepare(`SELECT COUNT(*) n FROM site_posts WHERE ${condition}`).get(...args).n;
  const rows=d.prepare(`SELECT ${publicFields} FROM site_posts WHERE ${condition} ORDER BY pinned DESC,COALESCE(published_at,created_at) DESC,id DESC LIMIT 20 OFFSET ?`).all(...args,(page-1)*20);
  return {rows,total,page,pages:Math.ceil(total/20)};
}
export function getPost(d,actor,id,{manage=false}={}){
  signedIn(actor);if(manage)admin(actor);ensurePostSchema(d);postId(id);
  const row=d.prepare(`SELECT ${publicFields},body,body_json FROM site_posts WHERE id=?${manage?'':" AND status='published'"}`).get(id);
  if(!row)error(404,'找不到貼文，或內容已下架。');return row;
}
export function savePost(d,actor,input,now=new Date().toISOString()){
  admin(actor);ensurePostSchema(d);
  if(!input||typeof input!=='object'||Array.isArray(input))error(400,'貼文格式不正確。');
  let document=null;
  if(input.body_json!=null){try{document=normalizePostDocument(input.body_json);}catch(e){if(e instanceof PostDocumentError)error(400,e.message);throw e;}}
  const type=kind(input.kind),title=text(input.title,'標題',160),body=document?document.text:text(input.body,'內文',60000);
  const summary=text(input.summary??'','摘要',500,false)||body.slice(0,160);
  if(!statuses.includes(input.status))error(400,'發布狀態不正確。');
  if(typeof input.pinned!=='boolean')error(400,'置頂設定不正確。');
  const id=input.id?postId(input.id):randomUUID();
  d.exec('BEGIN IMMEDIATE');
  try{
    const previous=d.prepare('SELECT * FROM site_posts WHERE id=?').get(id);
    if(input.id&&!previous)error(404,'找不到貼文。');
    if(previous&&(!Number.isSafeInteger(input.version)||input.version!==previous.version))error(409,'其他管理員已更新此貼文，請重新載入後再編輯。');
    const publishedAt=input.status==='published'?(previous?.published_at||now):(previous?.published_at||null);
    if(previous){
      d.prepare(`UPDATE site_posts SET kind=?,title=?,summary=?,body=?,status=?,pinned=?,updated_by=?,updated_at=?,published_at=?,version=version+1 WHERE id=?`).run(type,title,summary,body,input.status,Number(input.pinned),actor.email,now,publishedAt,id);
    }else{
      d.prepare(`INSERT INTO site_posts(id,kind,title,summary,body,status,pinned,author_name,created_by,updated_by,created_at,updated_at,published_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,type,title,summary,body,input.status,Number(input.pinned),actor.name?.trim()||'ASLUNG',actor.email,actor.email,now,now,publishedAt);
    }
    for(const image of document?.images||[])if(!d.prepare('SELECT 1 FROM site_post_images WHERE id=?').get(image))error(400,'圖片不存在，請重新上傳。');
    d.prepare('UPDATE site_posts SET body_json=? WHERE id=?').run(document?.json||null,id);
    d.prepare('DELETE FROM site_post_image_refs WHERE post_id=?').run(id);
    for(const image of document?.images||[])d.prepare('INSERT INTO site_post_image_refs VALUES(?,?)').run(id,image);
    const version=(previous?.version||0)+1;
    d.prepare('INSERT INTO site_post_events(post_id,actor,action,version,created_at) VALUES(?,?,?,?,?)').run(id,actor.email,`${previous?'update':'create'}:${input.status}`,version,now);
    d.exec('COMMIT');return getPost(d,actor,id,{manage:true});
  }catch(e){d.exec('ROLLBACK');throw e;}
}
