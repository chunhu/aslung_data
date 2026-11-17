import {normalizePostDocument,PostDocumentError} from './post-document.mjs';
import {randomUUID} from 'node:crypto';

export class PostError extends Error {constructor(status,message){super(message);this.status=status;}}
const kinds=['news','article'],statuses=['draft','published','archived'];
const publicFields='id,kind,title,summary,status,pinned,author_name,created_at,updated_at,published_at,version,visibility,title_en,summary_en,display_author,display_author_en';
const managementFields=publicFields+",created_by,updated_by,(SELECT actor FROM site_post_events WHERE post_id=site_posts.id AND action LIKE '%:published' ORDER BY id DESC LIMIT 1) AS published_by";
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
  if(!d.prepare('PRAGMA table_info(site_posts)').all().some(row=>row.name==='visibility'))d.exec("ALTER TABLE site_posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'members' CHECK(visibility IN ('members','public'))");
  for(const column of ['title_en','summary_en','body_en'])if(!d.prepare('PRAGMA table_info(site_posts)').all().some(row=>row.name===column))d.exec(`ALTER TABLE site_posts ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  if(!d.prepare('PRAGMA table_info(site_posts)').all().some(row=>row.name==='body_json_en'))d.exec('ALTER TABLE site_posts ADD COLUMN body_json_en TEXT');
  for(const [column,value] of [['display_author','平台編輯團隊'],['display_author_en','Editorial team']])if(!d.prepare('PRAGMA table_info(site_posts)').all().some(row=>row.name===column))d.exec(`ALTER TABLE site_posts ADD COLUMN ${column} TEXT NOT NULL DEFAULT '${value}'`);
  d.exec(`CREATE INDEX IF NOT EXISTS site_posts_public_feed ON site_posts(visibility,status,pinned,published_at);
    CREATE TABLE IF NOT EXISTS site_post_images(id TEXT PRIMARY KEY,data BLOB NOT NULL,mime_type TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS site_post_images_uploader ON site_post_images(created_by,created_at);
    CREATE TABLE IF NOT EXISTS site_post_image_refs(post_id TEXT NOT NULL REFERENCES site_posts(id) ON DELETE CASCADE,image_id TEXT NOT NULL REFERENCES site_post_images(id),PRIMARY KEY(post_id,image_id));
    CREATE INDEX IF NOT EXISTS site_post_image_lookup ON site_post_image_refs(image_id,post_id);`);
  d.exec('CREATE INDEX IF NOT EXISTS site_post_events_post ON site_post_events(post_id,id)');
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
  if(q){where.push('(instr(lower(title),lower(?))>0 OR instr(lower(summary),lower(?))>0 OR instr(lower(body),lower(?))>0 OR instr(lower(title_en),lower(?))>0 OR instr(lower(summary_en),lower(?))>0 OR instr(lower(body_en),lower(?))>0)');args.push(q,q,q,q,q,q);}
  const condition=where.join(' AND '),total=d.prepare(`SELECT COUNT(*) n FROM site_posts WHERE ${condition}`).get(...args).n;
  const rows=d.prepare(`SELECT ${manage?managementFields:publicFields.replace('author_name','display_author AS author_name')} FROM site_posts WHERE ${condition} ORDER BY pinned DESC,COALESCE(published_at,created_at) DESC,id DESC LIMIT 20 OFFSET ?`).all(...args,(page-1)*20);
  return {rows,total,page,pages:Math.ceil(total/20)};
}
export function getPost(d,actor,id,{manage=false}={}){
  signedIn(actor);if(manage)admin(actor);ensurePostSchema(d);postId(id);
  const row=d.prepare(`SELECT ${manage?managementFields:publicFields.replace('author_name','display_author AS author_name')},body,body_json,body_en,body_json_en FROM site_posts WHERE id=?${manage?'':" AND status='published'"}`).get(id);
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
    const titleEn=text(input.title_en??previous?.title_en??'','英文標題',160,false);
    const rawBodyEn=input.body_en??previous?.body_en??'';
    let englishDocument=null;
    const jsonEn=Object.hasOwn(input,'body_json_en')?input.body_json_en:(Object.hasOwn(input,'body_en')?null:previous?.body_json_en);
    if(jsonEn!=null){try{
      const parsed=typeof jsonEn==='string'?JSON.parse(jsonEn):jsonEn;
      const empty=parsed?.type==='doc'&&Array.isArray(parsed.content)&&parsed.content.every(p=>p.type==='paragraph'&&(!p.content||p.content.every(n=>n.type==='text'&&!String(n.text||'').trim()||n.type==='hardBreak')));
      if(!empty)englishDocument=normalizePostDocument(jsonEn);
    }catch(e){error(400,'英文內文格式不正確。');}}
    const bodyEn=englishDocument?englishDocument.text:text(rawBodyEn,'英文內文',60000,false);
    const rawSummaryEn=text(input.summary_en??previous?.summary_en??'','英文摘要',500,false);
    const hasEnglish=!!(titleEn||bodyEn||rawSummaryEn);
    if(input.status==='published'&&hasEnglish&&(!titleEn||!bodyEn))error(400,'發布英文版本前，請填寫英文標題與內文；或清空英文欄位以僅發布中文。');
    const summaryEn=rawSummaryEn||(bodyEn?bodyEn.slice(0,160):'');
    const displayAuthor=text(input.display_author??previous?.display_author??'平台編輯團隊','公開署名',160,false),displayAuthorEn=text(input.display_author_en??previous?.display_author_en??'Editorial team','英文公開署名',160,false);
    const visibility=input.visibility===undefined?(previous?.visibility||'members'):input.visibility;
    if(!['members','public'].includes(visibility))error(400,'請選擇會員限定或公開文章。');
    const publishedAt=input.status==='published'?(previous?.published_at||now):(previous?.published_at||null);
    if(previous){
      d.prepare(`UPDATE site_posts SET kind=?,title=?,summary=?,body=?,status=?,pinned=?,updated_by=?,updated_at=?,published_at=?,version=version+1 WHERE id=?`).run(type,title,summary,body,input.status,Number(input.pinned),actor.email,now,publishedAt,id);
    }else{
      d.prepare(`INSERT INTO site_posts(id,kind,title,summary,body,status,pinned,author_name,created_by,updated_by,created_at,updated_at,published_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,type,title,summary,body,input.status,Number(input.pinned),actor.name?.trim()||'ASLUNG',actor.email,actor.email,now,now,publishedAt);
    }
    const images=[...new Set([...(document?.images||[]),...(englishDocument?.images||[])])];
    if(images.length>30)error(400,'中英文版本合計最多 30 張不同圖片。');
    for(const image of images)if(!d.prepare('SELECT 1 FROM site_post_images WHERE id=?').get(image))error(400,'圖片不存在，請重新上傳。');
    d.prepare('UPDATE site_posts SET body_json=?,visibility=?,title_en=?,summary_en=?,body_en=?,body_json_en=?,display_author=?,display_author_en=? WHERE id=?').run(document?.json||null,visibility,titleEn,summaryEn,bodyEn,englishDocument?.json||null,displayAuthor,displayAuthorEn,id);
    d.prepare('DELETE FROM site_post_image_refs WHERE post_id=?').run(id);
    for(const image of images)d.prepare('INSERT INTO site_post_image_refs VALUES(?,?)').run(id,image);
    const version=(previous?.version||0)+1;
    d.prepare('INSERT INTO site_post_events(post_id,actor,action,version,created_at) VALUES(?,?,?,?,?)').run(id,actor.email,`${previous?'update':'create'}:${input.status}`,version,now);
    d.exec('COMMIT');return getPost(d,actor,id,{manage:true});
  }catch(e){d.exec('ROLLBACK');throw e;}
}

// Public readers never inherit membership, management mode or caller-supplied status.
const publicReaderFields='id,kind,title,summary,pinned,display_author AS author_name,published_at,visibility,title_en,summary_en,display_author,display_author_en';
/** @param {any} d @param {{type?:string|null,q?:string,page?:number,limit?:number}} [options] */
export function listPublicPosts(d,{type=null,q='',page=1,limit=20}={}){
  ensurePostSchema(d);if(type!==null)kind(type);q=text(q,'搜尋文字',160,false);
  if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(limit)||limit<1||limit>20)error(400,'頁碼不正確。');
  const where=["visibility='public'","status='published'"],args=[];
  if(type){where.push('kind=?');args.push(type);}
  if(q){where.push('(instr(lower(title),lower(?))>0 OR instr(lower(summary),lower(?))>0 OR instr(lower(body),lower(?))>0 OR instr(lower(title_en),lower(?))>0 OR instr(lower(summary_en),lower(?))>0 OR instr(lower(body_en),lower(?))>0)');args.push(q,q,q,q,q,q);}
  const condition=where.join(' AND '),total=d.prepare(`SELECT COUNT(*) n FROM site_posts WHERE ${condition}`).get(...args).n;
  const rows=d.prepare(`SELECT ${publicReaderFields} FROM site_posts WHERE ${condition} ORDER BY pinned DESC,COALESCE(published_at,created_at) DESC,id DESC LIMIT ? OFFSET ?`).all(...args,limit,(page-1)*limit).map(row=>({...row}));
  return {rows,total,page,pages:Math.ceil(total/limit)};
}
export function getPublicPost(d,id){
  ensurePostSchema(d);postId(id);
  const row=d.prepare(`SELECT ${publicReaderFields},body,body_json,body_en,body_json_en FROM site_posts WHERE id=? AND visibility='public' AND status='published'`).get(id);
  if(!row)error(404,'文章不存在或尚未公開。');return {...row};
}
