import {DEFAULT_HOMEPAGE_SETTINGS} from './homepage-options.mjs';
import {DEFAULT_HOMEPAGE_CONTENT,normalizeHomepageContent,validHomepageContent} from './homepage-content.mjs';
export class HomepageSettingsError extends Error{constructor(status,message){super(message);this.status=status;}}
const ready=new WeakSet();
function ensure(d){
 if(ready.has(d))return;
 d.exec(`CREATE TABLE IF NOT EXISTS homepage_settings(id INTEGER PRIMARY KEY CHECK(id=1),settings TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_by TEXT,updated_at TEXT)`);
 d.exec('BEGIN IMMEDIATE');try{
  if(!d.prepare('PRAGMA table_info(homepage_settings)').all().some(c=>c.name==='content'))d.exec("ALTER TABLE homepage_settings ADD COLUMN content TEXT NOT NULL DEFAULT '{}'");
  d.prepare('INSERT OR IGNORE INTO homepage_settings(id,settings,content) VALUES(1,?,?)').run(JSON.stringify(DEFAULT_HOMEPAGE_SETTINGS),JSON.stringify(DEFAULT_HOMEPAGE_CONTENT));
  d.exec('COMMIT');ready.add(d);
 }catch(e){d.exec('ROLLBACK');throw e;}
}
function state(d){ensure(d);const row=d.prepare('SELECT * FROM homepage_settings WHERE id=1').get();let saved={},content={};try{saved=JSON.parse(row.settings);}catch{/* Safe display defaults. */}try{content=JSON.parse(row.content);}catch{/* Safe text defaults. */}return {settings:Object.fromEntries(Object.entries(DEFAULT_HOMEPAGE_SETTINGS).map(([key,value])=>[key,typeof saved?.[key]==='boolean'?saved[key]:value])),content:normalizeHomepageContent(content),version:row.version,updated_by:row.updated_by,updated_at:row.updated_at};}
function admin(d,actor){const me=d.prepare('SELECT role,active FROM members WHERE email=?').get(actor?.email||'');if(!me?.active||me.role!=='admin')throw new HomepageSettingsError(403,'只有啟用中的系統管理員可以修改首頁設定。');}
export function publicHomepageSettings(d){return state(d).settings;}
export function publicHomepageContent(d){
 const {settings,content}=state(d);
 // Hidden section text must not leak through serialized React props in public HTML.
 return Object.fromEntries(Object.entries(content).filter(([key])=>key==='intro'||(key==='hero_device_label'?settings.hero_visual&&settings.hero_device_label:settings[key])));
}
export function getHomepageSettings(d,actor){admin(d,actor);return state(d);}
export function saveHomepageSettings(d,actor,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!Number.isSafeInteger(input.version)||input.version<1)throw new HomepageSettingsError(400,'請提供正確的設定版本。');
  const keys=Object.keys(DEFAULT_HOMEPAGE_SETTINGS),values=input.settings;
  if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length!==keys.length||keys.some(key=>typeof values[key]!=='boolean')||Object.keys(values).some(key=>!keys.includes(key)))throw new HomepageSettingsError(400,'請提供所有區塊的顯示勾選狀態。');
  if(input.content!==undefined&&!validHomepageContent(input.content))throw new HomepageSettingsError(400,'區塊內容格式不正確、名稱空白或文字超過長度限制。');
  ensure(d);d.exec('BEGIN IMMEDIATE');try{
    admin(d,actor);const settings=Object.fromEntries(keys.map(key=>[key,values[key]]));
    const content=input.content===undefined?state(d).content:normalizeHomepageContent(input.content);
    if(!d.prepare('UPDATE homepage_settings SET settings=?,content=?,version=version+1,updated_by=?,updated_at=? WHERE id=1 AND version=?').run(JSON.stringify(settings),JSON.stringify(content),actor.email,new Date().toISOString(),input.version).changes)throw new HomepageSettingsError(409,'首頁設定已由其他管理員更新，請重新載入後再儲存。');
    const result=state(d);d.exec('COMMIT');return result;
  }catch(e){d.exec('ROLLBACK');throw e;}
}
