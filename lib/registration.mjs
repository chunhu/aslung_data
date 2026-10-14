import {randomBytes, randomUUID} from 'node:crypto';
import {hashPassword, verifyPassword, validPassword, tokenHash} from './passwords.mjs';
import {COUNTRY_CODES} from './countries.mjs';

export class RegistrationError extends Error {
  constructor(status, message) { super(message); this.status=status; }
}
const error = (status, message) => { throw new RegistrationError(status,message); };
export function initializeRegistrationSchema(d) {
  d.exec(`CREATE TABLE IF NOT EXISTS member_profiles(
    email TEXT PRIMARY KEY REFERENCES members(email) ON DELETE CASCADE ON UPDATE CASCADE,
    country TEXT NOT NULL DEFAULT '', institution TEXT NOT NULL DEFAULT '', project_name TEXT NOT NULL DEFAULT '',
    project_summary TEXT NOT NULL DEFAULT '', requested_access TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'zh-TW',
    registration_status TEXT NOT NULL DEFAULT 'approved' CHECK(registration_status IN ('pending_email','pending_review','approved','rejected')),
    registered_at TEXT, email_verified_at TEXT, reviewed_at TEXT, reviewed_by TEXT, review_note TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS email_verifications(
    token_hash TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE ON UPDATE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS email_verifications_email ON email_verifications(email);
  CREATE TABLE IF NOT EXISTS registration_attempts(key TEXT PRIMARY KEY,window_start INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0);`);
}
function field(input,key,max,required=true) {
  const value = typeof input[key] === 'string' ? input[key].trim() : '';
  if ((required && !value) || value.length > max)
    error(400,`請完整填寫欄位並遵守字數限制 / Missing or overlong field: ${key}`);
  return value;
}
export function validateProfile(input, required=true) {
  const country=field(input,'country',2,required).toUpperCase();
  if (country && !COUNTRY_CODES.includes(country)) error(400,'請選擇有效國家／地區 / Select a valid country or region.');
  return {country, institution:field(input,'institution',200,required),
    project_name:field(input,'project_name',200,required), project_summary:field(input,'project_summary',1000,required),
    requested_access:field(input,'requested_access',1000,false)};
}
export function saveProfile(d,email,profile) {
  d.prepare(`INSERT INTO member_profiles(email,country,institution,project_name,project_summary,requested_access)
    VALUES(?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET country=excluded.country,institution=excluded.institution,
    project_name=excluded.project_name,project_summary=excluded.project_summary,requested_access=excluded.requested_access`)
    .run(email,profile.country,profile.institution,profile.project_name,profile.project_summary,profile.requested_access);
}
export function rateLimitRegistration(d,key,maximum,now=Date.now()) {
  const window=60*60*1000;
  d.prepare('DELETE FROM registration_attempts WHERE window_start<?').run(now-window);
  d.prepare(`INSERT INTO registration_attempts(key,window_start,attempts) VALUES(?,?,0)
    ON CONFLICT(key) DO NOTHING`).run(tokenHash(key),now);
  const reserved=d.prepare('UPDATE registration_attempts SET attempts=attempts+1 WHERE key=? AND attempts<? RETURNING attempts')
    .get(tokenHash(key),maximum);
  if (!reserved) error(429,'申請次數過多，請一小時後再試 / Too many requests. Try again in one hour.');
}
export async function registerMember(d,input,sendVerification) {
  const name=field(input,'name',160), nickname=field(input,'nickname',80).toLowerCase();
  const email=field(input,'email',254).toLowerCase(), profile=validateProfile(input);
  if (!/^[a-z0-9_-]+$/.test(nickname)) error(400,'帳號僅限英數字、底線與連字號 / Use letters, digits, underscores or hyphens for the username.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email)) error(400,'Email 格式不正確 / Invalid email address.');
  if (!validPassword(input.password)) error(400,'密碼需為 12 至 128 個字元 / Password must contain 12–128 characters.');
  if (input.password !== input.confirm_password) error(400,'兩次密碼不一致 / Passwords do not match.');
  rateLimitRegistration(d,'email:'+email,3);
  if (d.prepare('SELECT 1 FROM members WHERE LOWER(email)=? OR LOWER(nickname)=?').get(email,nickname))
    error(409,'Email 或登入帳號已被使用；若尚未收到驗證信，請使用重新寄送功能 / Email or username already registered. You can resend the verification email.');
  const hash=await hashPassword(input.password);
  const language=input.language==='en'?'en':'zh-TW', token=randomBytes(32).toString('hex'),now=Date.now();
  d.exec('BEGIN IMMEDIATE');
  try {
    d.prepare("INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,'member',0,?)")
      .run(email,randomUUID(),name,nickname,hash);
    saveProfile(d,email,profile);
    d.prepare("UPDATE member_profiles SET registration_status='pending_email',registered_at=?,language=? WHERE email=?")
      .run(new Date(now).toISOString(),language,email);
    d.prepare('INSERT INTO email_verifications(token_hash,email,expires_at) VALUES(?,?,?)').run(tokenHash(token),email,now+24*3600000);
    d.exec('COMMIT');
  } catch(e) {d.exec('ROLLBACK');if(String(e).includes('UNIQUE constraint')) error(409,'Email 或帳號已被使用 / Email or username already registered.');throw e;}
  await sendVerification({email,name,language,token});
}
export function verifyRegistration(d,token,now=Date.now()) {
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)) error(400,'驗證連結無效 / Invalid verification link.');
  d.exec('BEGIN IMMEDIATE');
  try {
    const row=d.prepare('SELECT email FROM email_verifications WHERE token_hash=? AND expires_at>?').get(tokenHash(token),now);
    if(!row) error(400,'驗證連結已失效或過期，請重新寄送 / Verification link expired or already used. Please resend it.');
    const result=d.prepare("UPDATE member_profiles SET email_verified_at=?,registration_status='pending_review' WHERE email=? AND registration_status='pending_email'")
      .run(new Date(now).toISOString(),row.email);
    if(!result.changes) error(400,'此申請不在 Email 驗證階段 / This application is no longer awaiting email verification.');
    d.prepare('DELETE FROM email_verifications WHERE email=?').run(row.email);
    d.exec('COMMIT');
  }catch(e){d.exec('ROLLBACK');throw e;}
}
export async function resendVerification(d,input,sendVerification) {
  const email=field(input,'email',254).toLowerCase();
  rateLimitRegistration(d,'resend:'+email,3);
  const row=d.prepare(`SELECT m.*,p.registration_status,p.language FROM members m
    JOIN member_profiles p ON p.email=m.email WHERE LOWER(m.email)=?`).get(email);
  if(!row || row.registration_status!=='pending_email' || !await verifyPassword(input.password,row.password_hash)) return;
  const token=randomBytes(32).toString('hex');
  d.exec('BEGIN IMMEDIATE');
  try {
    d.prepare('DELETE FROM email_verifications WHERE email=?').run(email);
    d.prepare('INSERT INTO email_verifications(token_hash,email,expires_at) VALUES(?,?,?)').run(tokenHash(token),email,Date.now()+24*3600000);
    d.exec('COMMIT');
  } catch(e){d.exec('ROLLBACK');throw e;}
  await sendVerification({email,name:row.name,language:row.language,token});
}
export function reviewRegistration(d,email,decision,reviewer,reason='') {
  if(!['approve','reject'].includes(decision)) error(400,'無效的審核動作 / Invalid review action.');
  if(typeof reason!=='string'||reason.length>1000) error(400,'審核備註最多 1,000 字 / Review note exceeds 1,000 characters.');
  d.exec('BEGIN IMMEDIATE');
  try {
    const profile=d.prepare('SELECT * FROM member_profiles WHERE email=?').get(email);
    if(!profile||!['pending_review','rejected'].includes(profile.registration_status)||!profile.email_verified_at)
      error(400,'此申請尚未驗證 Email 或不在待審核狀態 / Application must have a verified email and await review.');
    d.prepare('UPDATE member_profiles SET registration_status=?,reviewed_at=?,reviewed_by=?,review_note=? WHERE email=?')
      .run(decision==='approve'?'approved':'rejected',new Date().toISOString(),reviewer,reason.trim(),email);
    d.prepare('UPDATE members SET active=? WHERE email=? AND role=\'member\'').run(decision==='approve'?1:0,email);
    d.exec('COMMIT');
  }catch(e){d.exec('ROLLBACK');throw e;}
}
