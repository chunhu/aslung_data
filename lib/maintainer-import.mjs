import {createHash} from 'node:crypto';
import {parseImportTable} from './fleet-import.mjs';
import {MAINTAINER_FIELDS} from './maintainer-import-fields.mjs';
export class MaintainerImportError extends Error{constructor(status,message){super(message);this.status=status;}}
const reject=message=>{throw new MaintainerImportError(400,message);};
export function maintainerTable(text){
 if(typeof text!=='string'||text.length>2000000)reject('來源資料最多 2 MB。');
 let table;try{table=parseImportTable(text);}catch(e){reject(e.message);}
 if(!table.headers.length||!table.rows.length)reject('表格需要標題列與至少一筆資料。');
 if(table.rows.length>5000||table.headers.length>200)reject('單次最多 5000 列與 200 欄。');
 const headers=table.headers.map(h=>h.trim().toLowerCase());
 return {...table,mapping:Object.fromEntries(MAINTAINER_FIELDS.map(f=>[f.key,f.aliases.map(a=>headers.indexOf(a)).find(i=>i>=0)??-1]))};
}
export function previewMaintainers(d,text,mapping){
 const table=maintainerTable(text),issues=[],records=[],seen=new Set(),counts={added:0,updated:0,unchanged:0};
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||Object.keys(mapping).some(k=>!MAINTAINER_FIELDS.some(f=>f.key===k)))reject('欄位對應格式不正確。');
 const indexes=[];for(const f of MAINTAINER_FIELDS){const i=mapping[f.key];if(!Number.isInteger(i)||i< -1||i>=table.headers.length)reject(`${f.label}欄位對應不正確。`);if(f.required&&i<0)reject(`請對應「${f.label}」欄位。`);if(i>=0)indexes.push(i);}
 if(new Set(indexes).size!==indexes.length)reject('同一來源欄位不能重複對應。');
 const existing=d.prepare('SELECT name,email,english_name,email_test,phone,notes,offline_email_enabled FROM maintainers ORDER BY name').all();
 const byName=new Map(existing.map(r=>[r.name,r]));
 table.rows.forEach((cols,i)=>{
  const row=table.rowNumbers[i],record={row};let invalid=false;
  const error=message=>{invalid=true;issues.push({row,message});};
  for(const f of MAINTAINER_FIELDS)if(mapping[f.key]>=0){const v=String(cols[mapping[f.key]]||'').trim();record[f.key]=v;
   if(f.required&&!v)error(`${f.label}不得空白。`);
   if(v.length>f.max||(f.key==='notes'?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(v))error(`${f.label}超過長度限制或包含無效字元。`);
   if((f.key==='email'||f.key==='email_test')&&v){const addresses=v.split(/[,;]+/).map(a=>a.trim()).filter(Boolean);if(!addresses.length||addresses.some(a=>!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(a)))error(`${f.label}格式不正確。`);}
  }
  if(seen.has(record.name))error('姓名重複，請先合併同名資料。');seen.add(record.name);
  if(invalid)return;
  const old=byName.get(record.name),values=Object.fromEntries(MAINTAINER_FIELDS.map(f=>[f.key,Object.hasOwn(record,f.key)?record[f.key]:(old?.[f.key]||'')]));
  const change=!old?'added':MAINTAINER_FIELDS.some(f=>values[f.key]!==String(old[f.key]||''))?'updated':'unchanged';counts[change]++;
  records.push({...values,row,change});
 });
 const fingerprint=createHash('sha256').update(JSON.stringify({text,mapping,existing})).digest('hex');
 return {counts,issues,total:table.rows.length,records,fingerprint};
}
export function applyMaintainers(d,{text,mapping,fingerprint}){
 d.exec('BEGIN IMMEDIATE');try{
  const preview=previewMaintainers(d,text,mapping);
  if(typeof fingerprint!=='string'||preview.fingerprint!==fingerprint)throw new MaintainerImportError(409,'來源、欄位對應或名冊已變更，請重新預覽。');
  if(preview.issues.length)reject('請先修正預覽中的錯誤，再確認匯入。');
  const upsert=d.prepare(`INSERT INTO maintainers(name,email,english_name,email_test,phone,notes,created_at) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(name) DO UPDATE SET email=excluded.email,english_name=excluded.english_name,email_test=excluded.email_test,phone=excluded.phone,notes=excluded.notes`);
  for(const r of preview.records)if(r.change!=='unchanged')upsert.run(r.name,r.email,r.english_name,r.email_test,r.phone,r.notes,new Date().toISOString());
  d.exec('COMMIT');return {ok:true,...preview.counts,synced:preview.records.length};
 }catch(e){d.exec('ROLLBACK');throw e;}
}
