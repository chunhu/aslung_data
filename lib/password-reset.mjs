import {randomBytes} from 'node:crypto';
import {hashPassword,tokenHash,validPassword} from './passwords.mjs';

export class PasswordResetError extends Error{constructor(status,message){super(message);this.status=status;}}
const invalid=()=>new PasswordResetError(400,'重設連結無效或已過期，請重新申請 / Reset link is invalid or expired. Please request another.');
export const PASSWORD_RESET_TTL_MS=30*60*1000;
export function ensurePasswordResetSchema(d){
  d.exec(`CREATE TABLE IF NOT EXISTS password_resets(
    token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE ON UPDATE CASCADE,
    credential_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS password_resets_email ON password_resets(email);
    CREATE INDEX IF NOT EXISTS password_resets_expiry ON password_resets(expires_at);`);
}
export function resetEmail(value){
  if(typeof value!=='string'||value.length>254||!value.trim()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))throw new PasswordResetError(400,'請輸入註冊時使用的有效 Email / Enter the email address registered with your account.');
  return value.trim().toLowerCase();
}
// Bind to the account identity, email and current password. Any subsequent
// password/email change (including administrator/CLI changes) invalidates it.
const credential=member=>tokenHash(JSON.stringify([member.email,member.user_id,member.password_hash]));
export function issuePasswordReset(d,email,language='zh-TW',now=Date.now()){
  ensurePasswordResetSchema(d);
  d.prepare('DELETE FROM password_resets WHERE expires_at<=?').run(now);
  const member=d.prepare('SELECT email,user_id,password_hash FROM members WHERE LOWER(email)=? AND active=1').get(email);
  if(!member||member.email.toLowerCase().endsWith('@local.aslung'))return null;
  const token=randomBytes(32).toString('hex');
  d.exec('BEGIN IMMEDIATE');
  try{
    d.prepare('DELETE FROM password_resets WHERE email=?').run(member.email);
    d.prepare('INSERT INTO password_resets(token_hash,email,credential_hash,expires_at) VALUES(?,?,?,?)').run(tokenHash(token),member.email,credential(member),now+PASSWORD_RESET_TTL_MS);
    d.exec('COMMIT');
  }catch(e){d.exec('ROLLBACK');throw e;}
  return {email:member.email,language:language==='en'?'en':'zh-TW',token};
}
function resetAccount(d,token,now){
  const row=d.prepare(`SELECT m.email,m.user_id,m.password_hash,m.nickname,r.credential_hash FROM password_resets r
    JOIN members m ON m.email=r.email WHERE r.token_hash=? AND r.expires_at>? AND m.active=1`).get(tokenHash(token),now);
  if(!row||row.credential_hash!==credential(row))throw invalid();
  return row;
}
export async function completePasswordReset(d,{token,password,confirm_password},{now=Date.now,hash=hashPassword}={}){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw invalid();
  if(!validPassword(password))throw new PasswordResetError(400,'新密碼需為 12 至 128 個字元 / Password must contain 12–128 characters.');
  if(password!==confirm_password)throw new PasswordResetError(400,'兩次密碼不一致 / Passwords do not match.');
  ensurePasswordResetSchema(d);
  resetAccount(d,token,now());
  const passwordHash=await hash(password);
  // Recheck after expensive hashing, inside one write transaction. A token can
  // be consumed only once, including simultaneous requests or a new issuance.
  d.exec('BEGIN IMMEDIATE');
  try{
    const member=resetAccount(d,token,now());
    d.prepare('UPDATE members SET password_hash=? WHERE email=?').run(passwordHash,member.email);
    d.prepare('DELETE FROM sessions WHERE email=?').run(member.email);
    d.prepare('DELETE FROM password_resets WHERE email=?').run(member.email);
    d.prepare('DELETE FROM login_attempts WHERE email=? OR email=?').run(member.email.toLowerCase(),String(member.nickname||'').toLowerCase());
    d.exec('COMMIT');return member.email;
  }catch(e){d.exec('ROLLBACK');throw e;}
}
