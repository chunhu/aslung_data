import {randomUUID} from 'node:crypto';
import {backup} from 'node:sqlite';
import {mkdir,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {HoboError,ensureHoboSchema,hoboSerial,hoboRevision,hoboDeleting,withHoboLock} from './hobo.mjs';
import {hoboDayRange,purgeHoboScope} from './hobo-storage.mjs';

function snapshot(d,{serial='',from,to}){
  ensureHoboSchema(d);if(serial)hoboSerial(serial);
  const {start}=hoboDayRange(from),{end}=hoboDayRange(to);
  if(from>to)throw new HoboError(400,'開始日期不能晚於結束日期。');
  const serials=serial?[serial]:d.prepare('SELECT serial FROM hobo_loggers UNION SELECT logger_sn AS serial FROM hobo_observations UNION SELECT serial FROM hobo_archive_scopes ORDER BY serial').all().map(row=>row.serial);
  const items=[],revisions=[];
  for(const id of serials){
    if(hoboDeleting(d,id))throw new HoboError(409,'所選設備已有清除工作，請先等待完成或重試失敗工作。');
    revisions.push([id,d.prepare('SELECT revision FROM hobo_revisions WHERE serial=?').get(id)?.revision||0]);
    const days=d.prepare(`SELECT day FROM hobo_archive_scopes WHERE serial=? AND day>=? AND day<=? UNION
      SELECT day FROM hobo_archives WHERE serial=? AND day>=? AND day<=? UNION
      SELECT substr(datetime(timestamp,'+8 hours'),1,10) AS day FROM hobo_observations WHERE logger_sn=? AND timestamp>=? AND timestamp<? ORDER BY day`).all(id,from,to,id,from,to,id,start,end);
    for(const {day} of days){
      const period=hoboDayRange(day);
      const local=d.prepare('SELECT COUNT(*) count FROM hobo_observations WHERE logger_sn=? AND timestamp>=? AND timestamp<?').get(id,period.start,period.end).count;
      const archive=d.prepare('SELECT count,bytes FROM hobo_archives WHERE serial=? AND day=?').get(id,day);
      const scopes=d.prepare('SELECT serial,day,bucket,region FROM hobo_archive_scopes WHERE serial=? AND day=? ORDER BY bucket,region').all(id,day);
      items.push({serial:id,day,local,archived:archive?.count||0,bytes:archive?.bytes||0,scopes});
      if(items.length>20000)throw new HoboError(400,'每批最多清除 20,000 個設備日，請縮小範圍。');
    }
  }
  return {filters:{serial,from,to},serials,revisions,items};
}
export function previewHoboCleanup(d,filters,actor,now=Date.now()){
  const payload=snapshot(d,filters),id=randomUUID();
  d.prepare('INSERT INTO hobo_cleanup_plans(id,actor,expires,payload,created_at) VALUES(?,?,?,?,?)').run(id,actor,now+900000,JSON.stringify(payload),new Date(now).toISOString());
  return {id,filters:payload.filters,devices:payload.serials.length,days:payload.items.length,
    local:payload.items.reduce((n,item)=>n+item.local,0),archived:payload.items.reduce((n,item)=>n+item.archived,0),
    scopes:payload.items.reduce((n,item)=>n+item.scopes.length,0),bytes:payload.items.reduce((n,item)=>n+item.bytes,0),items:payload.items.slice(0,50)};
}
async function backupHobo(d,id){
  const directory=resolve(process.env.BACKUP_PATH||'backups');await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(directory,'before-hobo-cleanup-'+id+'.sqlite');await backup(d,path);await chmod(path,0o600);return path;
}
export async function confirmHoboCleanup(d,{id,actor,confirmation},backupFn=backupHobo,now=Date.now()){
  ensureHoboSchema(d);
  if(confirmation!=='DELETE')throw new HoboError(400,'請輸入 DELETE 確認。');
  const plan=d.prepare("SELECT * FROM hobo_cleanup_plans WHERE id=? AND actor=? AND status='PREVIEW' AND expires>?").get(id,actor,now);
  if(!plan)throw new HoboError(409,'預覽已過期或已使用，請重新預覽。');
  const payload=JSON.parse(plan.payload);
  if(!payload.items.length)throw new HoboError(400,'此範圍沒有可清除的資料。');
  const path=await backupFn(d,id);
  const confirmed=await withHoboLock(d,()=>{
    d.exec('BEGIN IMMEDIATE');
    try{
      const current=d.prepare("SELECT 1 FROM hobo_cleanup_plans WHERE id=? AND status='PREVIEW' AND expires>?").get(id,Date.now());
      if(!current||JSON.stringify(snapshot(d,payload.filters))!==plan.payload)throw new HoboError(409,'資料已變更，請重新預覽清除範圍。');
      for(const serial of payload.serials){
        d.prepare('UPDATE hobo_loggers SET enabled=0 WHERE serial=?').run(serial);
        d.prepare("UPDATE hobo_jobs SET status='CANCELLED',lease_until=0,lease_token='' WHERE serial=? AND status IN ('QUEUED','RUNNING','FAILED')").run(serial);
      }
      const insert=d.prepare('INSERT INTO hobo_cleanup_items(id,plan,serial,day,scopes) VALUES(?,?,?,?,?)');
      for(const item of payload.items)insert.run(randomUUID(),id,item.serial,item.day,JSON.stringify(item.scopes));
      d.prepare("UPDATE hobo_cleanup_plans SET status='QUEUED',backup_path=? WHERE id=?").run(path,id);
      d.exec('COMMIT');return {ok:true,id,days:payload.items.length};
    }catch(e){d.exec('ROLLBACK');throw e;}
  });
  if(!confirmed)throw new HoboError(409,'HOBO 同步或歸檔正在執行，請稍後再確認清除。');
  return confirmed;
}
export function hoboCleanupStatus(d){
  ensureHoboSchema(d);
  return {plans:d.prepare(`SELECT p.id,p.status,p.created_at,COUNT(i.id) total,SUM(i.status='DONE') done,SUM(i.status='RETRY') failed
    FROM hobo_cleanup_plans p LEFT JOIN hobo_cleanup_items i ON i.plan=p.id WHERE p.status!='PREVIEW' GROUP BY p.id ORDER BY p.created_at DESC LIMIT 20`).all(),
    errors:d.prepare("SELECT id,plan,serial,day,error,retry_at FROM hobo_cleanup_items WHERE status='RETRY' ORDER BY retry_at LIMIT 20").all()};
}
export function retryHoboCleanup(d,id){
  ensureHoboSchema(d);
  if(!d.prepare("SELECT 1 FROM hobo_cleanup_plans WHERE id=? AND status!='DONE' AND status!='PREVIEW'").get(id))throw new HoboError(404,'找不到可重試的清除工作。');
  d.prepare("UPDATE hobo_cleanup_items SET retry_at=0 WHERE plan=? AND status='RETRY'").run(id);
}
export async function runHoboCleanup(d,{purge=purgeHoboScope,now=Date.now()}={}){
  ensureHoboSchema(d);
  return withHoboLock(d,async heartbeat=>{
    const item=d.prepare("SELECT * FROM hobo_cleanup_items WHERE status!='DONE' AND retry_at<=? ORDER BY retry_at,rowid LIMIT 1").get(now);
    if(!item)return null;
    d.prepare("UPDATE hobo_cleanup_plans SET status='RUNNING' WHERE id=?").run(item.plan);
    try{
      for(const scope of JSON.parse(item.scopes)){heartbeat();await purge(scope,undefined,heartbeat);}
      heartbeat();const range=hoboDayRange(item.day);d.exec('BEGIN IMMEDIATE');
      try{
        d.prepare('DELETE FROM hobo_observations WHERE logger_sn=? AND timestamp>=? AND timestamp<?').run(item.serial,range.start,range.end);
        d.prepare('DELETE FROM hobo_archives WHERE serial=? AND day=?').run(item.serial,item.day);
        d.prepare('DELETE FROM hobo_archive_scopes WHERE serial=? AND day=?').run(item.serial,item.day);
        d.prepare("UPDATE hobo_cleanup_items SET status='DONE',error='' WHERE id=?").run(item.id);hoboRevision(d,item.serial);
        if(!d.prepare("SELECT 1 FROM hobo_cleanup_items WHERE plan=? AND status!='DONE'").get(item.plan)){
          const payload=JSON.parse(d.prepare('SELECT payload FROM hobo_cleanup_plans WHERE id=?').get(item.plan).payload);
          const {start}=hoboDayRange(payload.filters.from),{end}=hoboDayRange(payload.filters.to);
          for(const serial of payload.serials)d.prepare('DELETE FROM hobo_jobs WHERE serial=? AND start<? AND end>=?').run(serial,end,start);
          d.prepare("UPDATE hobo_cleanup_plans SET status='DONE' WHERE id=?").run(item.plan);
        }
        d.exec('COMMIT');return {id:item.id,status:'DONE'};
      }catch(e){d.exec('ROLLBACK');throw e;}
    }catch(e){
      const attempts=item.attempts+1,error=e instanceof HoboError?e.message:'HOBO 清除失敗，本機資料與索引保留供重試。';
      d.prepare("UPDATE hobo_cleanup_items SET status='RETRY',attempts=?,retry_at=?,error=? WHERE id=?").run(attempts,now+Math.min(3600000,30000*2**Math.min(attempts,10)),error,item.id);
      d.prepare("UPDATE hobo_cleanup_plans SET status='RETRY' WHERE id=?").run(item.plan);return {id:item.id,status:'RETRY'};
    }
  });
}
