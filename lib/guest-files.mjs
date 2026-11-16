import {randomBytes,randomInt,createHash,timingSafeEqual} from 'node:crypto';

export class GuestFileError extends Error{constructor(status,message){super(message);this.status=status;}}
const error=(status,message)=>{throw new GuestFileError(status,message);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const secret=()=>randomBytes(32).toString('hex');
const ready=new WeakSet();
export function ensureGuestFileSchema(d){
 if(ready.has(d))return;
 d.exec(`CREATE TABLE IF NOT EXISTS guest_file_publications(file_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS guest_file_requests(id TEXT PRIMARY KEY,file_id TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,organization TEXT NOT NULL,purpose TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'unverified',review_note TEXT NOT NULL DEFAULT '',reviewed_by TEXT,reviewed_at TEXT,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS guest_requests_time ON guest_file_requests(created_at,id);
 CREATE TABLE IF NOT EXISTS guest_file_shares(id TEXT PRIMARY KEY,file_id TEXT NOT NULL,file_name TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,organization TEXT NOT NULL,purpose TEXT NOT NULL,request_id TEXT UNIQUE,token_hash TEXT UNIQUE NOT NULL,expires_at INTEGER NOT NULL,max_downloads INTEGER NOT NULL CHECK(max_downloads>0),used_downloads INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL,created_at TEXT NOT NULL,mail_status TEXT NOT NULL DEFAULT 'pending');
 CREATE INDEX IF NOT EXISTS guest_shares_time ON guest_file_shares(created_at,id);
 CREATE TABLE IF NOT EXISTS guest_file_codes(context TEXT PRIMARY KEY,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS guest_file_sessions(token_hash TEXT PRIMARY KEY,share_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS guest_sessions_expiry ON guest_file_sessions(expires_at);
 CREATE TABLE IF NOT EXISTS guest_file_rate(key TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS guest_file_downloads(id TEXT PRIMARY KEY,share_id TEXT NOT NULL,file_id TEXT NOT NULL,file_name TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,organization TEXT NOT NULL,purpose TEXT NOT NULL,ip TEXT NOT NULL,user_agent TEXT NOT NULL,status TEXT NOT NULL,bytes INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,finished_at TEXT);
 CREATE INDEX IF NOT EXISTS guest_download_time ON guest_file_downloads(created_at,id);`);
 ready.add(d);
}
function text(value,label,max=160){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))error(400,`請填寫有效的${label}。`);return value.trim();}
function recipient(p){const email=text(p.email,'Email',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))error(400,'Email 格式不正確。');return {email,name:text(p.name,'姓名'),organization:text(p.organization,'單位'),purpose:text(p.purpose,'用途',2000)};}
function tx(d,work){d.exec('BEGIN IMMEDIATE');try{const result=work();d.exec('COMMIT');return result;}catch(e){d.exec('ROLLBACK');throw e;}}
function admin(d,actor){if(!d.prepare("SELECT 1 FROM members WHERE email=? AND role='admin' AND active=1").get(actor?.email))error(403,'只有系統管理員可以管理訪客分享。');}
function file(d,id){const f=d.prepare('SELECT * FROM files WHERE id=?').get(text(id,'檔案編號'));if(!f)error(404,'檔案不存在或已移除。');return f;}
function limits(p,now){const expires=Date.parse(p.expires_at);if(typeof p.expires_at!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(p.expires_at)||!Number.isFinite(expires)||expires<=now||expires>now+366*86400000)error(400,'請指定未來一年內、包含時區的到期時間。');const n=p.max_downloads;if(!Number.isSafeInteger(n)||n<1||n>10000)error(400,'下載次數上限為 1 至 10000 次。');return {expires,n};}
function activeShare(d,token,now){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))error(403,'下載連結無效或已到期。');const s=d.prepare('SELECT * FROM guest_file_shares WHERE token_hash=?').get(hash(token));return checkShare(d,s,now);}
function checkShare(d,s,now){if(!s||!s.enabled||s.expires_at<=now||s.used_downloads>=s.max_downloads)error(403,'下載連結已停用、到期或達下載次數上限。');file(d,s.file_id);return s;}
export function guestRate(d,key,max,windowMs=3600000,now=Date.now()){
 ensureGuestFileSchema(d);const window=Math.floor(now/windowMs),id=hash(key);
 // A fixed window per key; hashed keys contain neither email addresses nor IPs.
 d.prepare('INSERT INTO guest_file_rate VALUES(?,?,0) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count ELSE 0 END,window=excluded.window').run(id,window);
 if(!d.prepare('UPDATE guest_file_rate SET count=count+1 WHERE key=? AND count<? RETURNING count').get(id,max))error(429,'要求過於頻繁，請稍後再試。');
}
export function publicGuestFiles(d,{q='',page=1}={}){
 ensureGuestFileSchema(d);q=String(q).slice(0,160);page=Number(page);if(!Number.isSafeInteger(page)||page<1)error(400,'頁碼不正確。');
 const where="FROM files f JOIN guest_file_publications p ON p.file_id=f.id WHERE p.enabled=1 AND (instr(lower(f.name),lower(?))>0 OR instr(lower(COALESCE(f.description,'')),lower(?))>0)";
 const total=d.prepare('SELECT COUNT(*) n '+where).get(q,q).n;
 return {total,page,pages:Math.ceil(total/20),rows:d.prepare('SELECT f.id,f.name,f.description,f.size '+where+' ORDER BY f.created_at DESC,f.id LIMIT 20 OFFSET ?').all(q,q,(page-1)*20)};
}
export function setGuestPublication(d,actor,p){ensureGuestFileSchema(d);return tx(d,()=>{admin(d,actor);const f=file(d,p.file_id);if(typeof p.enabled!=='boolean')error(400,'請指定是否公開。');d.prepare('INSERT INTO guest_file_publications VALUES(?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(f.id,p.enabled?1:0,actor.email,new Date().toISOString());return {ok:true};});}
function issueCode(d,context,now){const code=String(randomInt(0,1000000)).padStart(6,'0');d.prepare('INSERT INTO guest_file_codes VALUES(?,?,?,0) ON CONFLICT(context) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0').run(context,hash(context+':'+code),now+600000);return code;}
function verifyCode(d,context,code,now){
 const problem=tx(d,()=>{
   const row=d.prepare('SELECT * FROM guest_file_codes WHERE context=?').get(context);
   if(!row||row.expires_at<=now||row.attempts>=5)return '驗證碼已失效，請重新取得。';
   // Commit failed attempts; a code can be consumed only once across server processes.
   d.prepare('UPDATE guest_file_codes SET attempts=attempts+1 WHERE context=?').run(context);
   const actual=hash(context+':'+String(code));if(typeof code!=='string'||!/^\d{6}$/.test(code)||!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(row.code_hash,'hex')))return '驗證碼不正確。';
   d.prepare('DELETE FROM guest_file_codes WHERE context=?').run(context);return null;
 });
 if(problem)error(400,problem);
}
export function beginGuestRequest(d,p,now=Date.now()){
 ensureGuestFileSchema(d);const f=file(d,p.file_id);if(!d.prepare('SELECT 1 FROM guest_file_publications WHERE file_id=? AND enabled=1').get(f.id))error(404,'此檔案目前不接受公開申請。');
 const r=recipient(p);guestRate(d,'request:'+r.email,5,3600000,now);const id=secret();
 return tx(d,()=>{d.prepare('INSERT INTO guest_file_requests(id,file_id,email,name,organization,purpose,created_at) VALUES(?,?,?,?,?,?,?)').run(id,f.id,r.email,r.name,r.organization,r.purpose,new Date(now).toISOString());return {id,email:r.email,code:issueCode(d,'request:'+id,now)};});
}
export function verifyGuestRequest(d,{id,code},now=Date.now()){
 ensureGuestFileSchema(d);if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))error(400,'申請無效。');
 const r=d.prepare("SELECT * FROM guest_file_requests WHERE id=? AND status='unverified'").get(id);if(!r)error(400,'申請已送出或失效。');
 file(d,r.file_id);if(!d.prepare('SELECT 1 FROM guest_file_publications WHERE file_id=? AND enabled=1').get(r.file_id))error(403,'此檔案已停止公開申請。');
 verifyCode(d,'request:'+id,code,now);
 d.prepare("UPDATE guest_file_requests SET status='pending' WHERE id=? AND status='unverified'").run(id);return {ok:true};
}
export function beginGuestDownload(d,token,now=Date.now()){
 ensureGuestFileSchema(d);const s=activeShare(d,token,now);guestRate(d,'code:share:'+s.id,5,3600000,now);guestRate(d,'code:email:'+s.email,10,3600000,now);
 return {email:s.email,code:issueCode(d,'share:'+s.id,now),masked_email:s.email[0]+'***@'+s.email.split('@')[1]};
}
export function verifyGuestDownload(d,{token,code},now=Date.now()){
 ensureGuestFileSchema(d);const s=activeShare(d,token,now);verifyCode(d,'share:'+s.id,code,now);
 const session=secret();d.prepare('DELETE FROM guest_file_sessions WHERE expires_at<=?').run(now);
 d.prepare('INSERT INTO guest_file_sessions VALUES(?,?,?)').run(hash(session),s.id,Math.min(s.expires_at,now+1800000));
 return {session,name:file(d,s.file_id).name,remaining:s.max_downloads-s.used_downloads,expires_at:new Date(s.expires_at).toISOString()};
}
function insertShare(d,actor,f,r,p,requestId,now){
 const {expires,n}=limits(p,now),token=secret(),id=randomBytes(16).toString('hex');
 d.prepare('INSERT INTO guest_file_shares(id,file_id,file_name,email,name,organization,purpose,request_id,token_hash,expires_at,max_downloads,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,f.id,f.name,r.email,r.name,r.organization,r.purpose,requestId,hash(token),expires,n,actor.email,new Date(now).toISOString());
 return {id,token,email:r.email,file_name:f.name,expires_at:new Date(expires).toISOString(),max_downloads:n};
}
export function createGuestShare(d,actor,p,now=Date.now()){
 ensureGuestFileSchema(d);return tx(d,()=>{admin(d,actor);return insertShare(d,actor,file(d,p.file_id),recipient(p),p,null,now);});
}
export function reviewGuestRequest(d,actor,p,now=Date.now()){
 ensureGuestFileSchema(d);return tx(d,()=>{admin(d,actor);const r=d.prepare("SELECT * FROM guest_file_requests WHERE id=? AND status='pending'").get(p.id);if(!r)error(409,'此申請已處理或尚未完成 Email 驗證。');if(!['approve','reject'].includes(p.decision))error(400,'審核結果不正確。');const note=p.note?text(p.note,'審核備註',1000):'';
 const share=p.decision==='approve'?insertShare(d,actor,file(d,r.file_id),r,p,r.id,now):null;
 d.prepare('UPDATE guest_file_requests SET status=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=?').run(share?'approved':'rejected',note,actor.email,new Date(now).toISOString(),r.id);return share||{ok:true};});
}
export function disableGuestShare(d,actor,p){ensureGuestFileSchema(d);return tx(d,()=>{admin(d,actor);const changes=d.prepare('UPDATE guest_file_shares SET enabled=0 WHERE id=?').run(text(p.id,'連結編號')).changes;if(!changes)error(404,'找不到分享連結。');d.prepare('DELETE FROM guest_file_sessions WHERE share_id=?').run(p.id);return {ok:true};});}
export function reissueGuestShare(d,actor,p,now=Date.now()){
 ensureGuestFileSchema(d);return tx(d,()=>{admin(d,actor);const s=checkShare(d,d.prepare('SELECT * FROM guest_file_shares WHERE id=?').get(text(p.id,'連結編號')),now),token=secret();d.prepare("UPDATE guest_file_shares SET token_hash=?,mail_status='pending' WHERE id=?").run(hash(token),s.id);d.prepare('DELETE FROM guest_file_sessions WHERE share_id=?').run(s.id);d.prepare('DELETE FROM guest_file_codes WHERE context=?').run('share:'+s.id);return {id:s.id,token,email:s.email,file_name:s.file_name,expires_at:new Date(s.expires_at).toISOString(),max_downloads:s.max_downloads-s.used_downloads};});
}
export function markGuestMail(d,id,ok){d.prepare('UPDATE guest_file_shares SET mail_status=? WHERE id=?').run(ok?'sent':'failed',id);}
export function guestDownloadFile(d,session,now=Date.now()){
 ensureGuestFileSchema(d);if(typeof session!=='string'||!/^[a-f0-9]{64}$/.test(session))error(403,'請先驗證 Email。');const row=d.prepare('SELECT share_id FROM guest_file_sessions WHERE token_hash=? AND expires_at>?').get(hash(session),now);if(!row)error(403,'驗證已到期，請重新取得驗證碼。');const s=checkShare(d,d.prepare('SELECT * FROM guest_file_shares WHERE id=?').get(row.share_id),now);return {share:s,file:file(d,s.file_id)};
}
export function reserveGuestDownload(d,session,{ip='',userAgent=''}={},now=Date.now()){
 ensureGuestFileSchema(d);
 return tx(d,()=>{const {share:s,file:f}=guestDownloadFile(d,session,now);
 if(!d.prepare('UPDATE guest_file_shares SET used_downloads=used_downloads+1 WHERE id=? AND enabled=1 AND expires_at>? AND used_downloads<max_downloads').run(s.id,now).changes)error(403,'下載次數已用完。');
 const id=randomBytes(16).toString('hex');d.prepare('INSERT INTO guest_file_downloads(id,share_id,file_id,file_name,email,name,organization,purpose,ip,user_agent,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,s.id,f.id,f.name,s.email,s.name,s.organization,s.purpose,String(ip).slice(0,64),String(userAgent).slice(0,255),'started',new Date(now).toISOString());
 d.prepare('UPDATE files SET download_count=download_count+1 WHERE id=?').run(f.id);return {id,file:f};});
}
export function finishGuestDownload(d,id,status,bytes=0){if(!['completed','interrupted','failed','redirected'].includes(status))return;d.prepare("UPDATE guest_file_downloads SET status=?,bytes=?,finished_at=? WHERE id=? AND status='started'").run(status,bytes,new Date().toISOString(),id);}
function filters(p){const q=String(p.q||'').slice(0,160),fileId=String(p.file_id||'');let start=null,end=null;
 for(const key of ['start','end'])if(p[key]){if(!Number.isFinite(Date.parse(p[key])))error(400,'查詢日期不正確。');if(key==='start')start=new Date(p[key]).toISOString();else end=new Date(p[key]).toISOString();}
 return {q,fileId,start,end};}
export function guestAdminOverview(d,actor,p={}){
 ensureGuestFileSchema(d);admin(d,actor);const {q,fileId,start,end}=filters(p),page=Number(p.page||1);if(!Number.isSafeInteger(page)||page<1)error(400,'頁碼不正確。');
 const list=(table,fields,extra='',args=[])=>{const where=` WHERE (?='' OR file_id=?) AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?) AND (instr(lower(email||' '||name||' '||organization||' '||purpose),lower(?))>0) ${extra}`,values=[fileId,fileId,start,start,end,end,q,...args];return {total:d.prepare(`SELECT COUNT(*) n FROM ${table}`+where).get(...values).n,rows:d.prepare(`SELECT ${fields} FROM ${table}`+where+' ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?').all(...values,(page-1)*30)};};
 return {page,publication:fileId?!!d.prepare('SELECT enabled FROM guest_file_publications WHERE file_id=?').get(fileId)?.enabled:null,
 requests:list('guest_file_requests',"id,file_id,email,name,organization,purpose,status,review_note,reviewed_by,reviewed_at,created_at",p.request_status?'AND status=?':"AND status<>'unverified'",p.request_status?[text(p.request_status,'申請狀態')]:[]),
 shares:list('guest_file_shares','id,file_id,file_name,email,name,organization,purpose,request_id,expires_at,max_downloads,used_downloads,enabled,created_by,created_at,mail_status'),
 downloads:list('guest_file_downloads','*',p.download_status?'AND status=?':'',p.download_status?[text(p.download_status,'下載狀態')]:[])};
}
const csvCell=value=>'"'+String(value??'').replace(/^(?=\s*[=+\-@]|[\t\r])/,'\'').replaceAll('"','""')+'"';
export function exportGuestDownloads(d,actor,p={}){
 ensureGuestFileSchema(d);admin(d,actor);const {q,fileId,start,end}=filters(p),status=String(p.download_status||'');
 const rows=d.prepare(`SELECT created_at,file_name,email,name,organization,purpose,status,bytes,ip,user_agent,finished_at,share_id FROM guest_file_downloads WHERE (?='' OR file_id=?) AND (?='' OR status=?) AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?) AND instr(lower(email||' '||name||' '||organization||' '||purpose),lower(?))>0 ORDER BY created_at DESC,id DESC LIMIT 10001`).all(fileId,fileId,status,status,start,start,end,end,q);
 if(rows.length>10000)error(400,'單次匯出上限 10000 筆，請縮小日期或檔案範圍。');
 const columns=['created_at','file_name','email','name','organization','purpose','status','bytes','ip','user_agent','finished_at','share_id'];return '\uFEFF'+[columns,...rows.map(r=>columns.map(k=>r[k]))].map(r=>r.map(csvCell).join(',')).join('\r\n');
}
