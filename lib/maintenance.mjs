import {randomUUID} from 'node:crypto';
import {currentDeploymentMap} from './device-deployments.mjs';
import {ensureFleetSchema} from './fleet-store.mjs';

import {MAINTENANCE_TYPES,MAINTENANCE_STATUSES} from './maintenance-labels.mjs';
export {MAINTENANCE_TYPES,MAINTENANCE_STATUSES};
export class MaintenanceError extends Error{constructor(message,status=400){super(message);this.status=status;}}
export function ensureMaintenanceSchema(d){
  d.exec(`CREATE TABLE IF NOT EXISTS maintenance_orders(
    id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,
    type TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL,
    reported_date TEXT NOT NULL,due_date TEXT,next_service_date TEXT,assignee TEXT NOT NULL,vendor TEXT NOT NULL,
    lab_snapshot TEXT NOT NULL,maintainer_snapshot TEXT NOT NULL,responsible_email TEXT NOT NULL,
    result TEXT NOT NULL DEFAULT '',cost_cents INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT);
    CREATE INDEX IF NOT EXISTS maintenance_device ON maintenance_orders(device_id,created_at);
    CREATE TABLE IF NOT EXISTS maintenance_entries(id INTEGER PRIMARY KEY,order_id TEXT NOT NULL REFERENCES maintenance_orders(id),
      kind TEXT NOT NULL,content TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS maintenance_attachments(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES maintenance_orders(id),
      name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,data BLOB NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);`);
}
const text=(v,max=200,required=false)=>{
  if(v==null&&!required)return '';
  if(typeof v!=='string'||v.trim().length>max||(required&&!v.trim()))throw new MaintenanceError(`請填寫有效內容（上限 ${max} 字）。`);
  return v.trim();
};
function date(v,required=false){
  const s=text(v,10,required);if(!s)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw new MaintenanceError('日期格式或日期無效。');
  return s;
}
function context(d,me){
  const current=currentDeploymentMap(d.prepare('SELECT * FROM device_locations').all());
  // Verified maintainer email only: a member cannot claim access by changing their display name.
  const names=new Set(d.prepare("SELECT name FROM maintainers WHERE email<>'' AND LOWER(email)=LOWER(?)").all(me.email).map(m=>m.name));
  return {current,names};
}
const owns=(order,me)=>[order.created_by,order.responsible_email].some(email=>email?.toLowerCase()===me.email.toLowerCase());
function allowed(order,me,ctx){return me.role==='admin'||owns(order,me)||ctx.names.has(ctx.current.get(order.device_id)?.maintainer);}
function entry(d,id,kind,content,actor,now){d.prepare('INSERT INTO maintenance_entries(order_id,kind,content,actor,created_at) VALUES(?,?,?,?,?)').run(id,kind,content,actor,now);}
function transaction(d,fn){
  const nested=d.isTransaction;
  d.exec(nested?'SAVEPOINT maintenance_write':'BEGIN IMMEDIATE');
  try{const result=fn();d.exec(nested?'RELEASE maintenance_write':'COMMIT');return result;}
  catch(e){if(nested){d.exec('ROLLBACK TO maintenance_write');d.exec('RELEASE maintenance_write');}else d.exec('ROLLBACK');throw e;}
}
export function listMaintenance(d,me,id){
  ensureMaintenanceSchema(d);const ctx=context(d,me);
  if(id){
    const order=d.prepare('SELECT * FROM maintenance_orders WHERE id=?').get(id);
    if(!order||!allowed(order,me,ctx))throw new MaintenanceError('找不到可存取的維修保養紀錄。',404);
    return {order,entries:d.prepare('SELECT * FROM maintenance_entries WHERE order_id=? ORDER BY id').all(id),
      attachments:d.prepare('SELECT id,name,mime,size,actor,created_at FROM maintenance_attachments WHERE order_id=? ORDER BY created_at').all(id)};
  }
  const orders=d.prepare('SELECT * FROM maintenance_orders ORDER BY updated_at DESC,id').all().filter(o=>allowed(o,me,ctx));
  const devices=d.prepare('SELECT id,status FROM devices ORDER BY id').all().filter(dev=>me.role==='admin'||ctx.names.has(ctx.current.get(dev.id)?.maintainer));
  return {orders,devices,canUse:me.role==='admin'||orders.length>0||devices.length>0,maintainers:me.role==='admin'?d.prepare('SELECT name FROM maintainers ORDER BY name').all():[]};
}
export function saveMaintenance(d,me,p){
  ensureMaintenanceSchema(d);if(!p||typeof p!=='object'||Array.isArray(p))throw new MaintenanceError('操作參數無效。');
  const now=new Date().toISOString();
  return transaction(d,()=>{
    const ctx=context(d,me);
    if(p.action==='create'){
      const deviceId=text(p.device_id,80,true),device=d.prepare('SELECT * FROM devices WHERE id=?').get(deviceId),loc=ctx.current.get(deviceId);
      if(!device)throw new MaintenanceError('設備不存在。',404);
      if(me.role!=='admin'&&!ctx.names.has(loc?.maintainer))throw new MaintenanceError('只能為目前負責的設備建立紀錄。',403);
      if(!Object.hasOwn(MAINTENANCE_TYPES,p.type))throw new MaintenanceError('請選擇紀錄類型。');
      const reported=date(p.reported_date,true),due=date(p.due_date),next=date(p.next_service_date);
      if(due&&due<reported)throw new MaintenanceError('預計完成日期不能早於發現日期。');
      const assignee=me.role==='admin'?text(p.assignee):text(loc?.maintainer);
      if(assignee&&!d.prepare('SELECT name FROM maintainers WHERE name=?').get(assignee))throw new MaintenanceError('請選擇已建檔的負責人。');
      const responsible=d.prepare('SELECT email FROM maintainers WHERE name=?').get(assignee||loc?.maintainer||'')?.email||'';
      const id='mw_'+randomUUID(),title=text(p.title,200,true),description=text(p.description,6000,true);
      if(p.set_maintenance===true){
        if(me.role!=='admin')throw new MaintenanceError('只有管理員可以變更設備狀態。',403);
        if(!['DEPLOYED','STANDBY','MAINTENANCE'].includes(device.status))throw new MaintenanceError('此設備狀態無法送修。');
        if(d.prepare("SELECT 1 FROM device_locations WHERE aslung_id=? AND active=1 AND (end_time IS NULL OR end_time='') AND start_time>?").get(deviceId,now))throw new MaintenanceError('設備含未來部署，請先整理部署紀錄。');
        d.prepare("UPDATE device_locations SET active=0,end_time=? WHERE aslung_id=? AND active=1 AND (end_time IS NULL OR end_time='')").run(now,deviceId);
        d.prepare("UPDATE devices SET status='MAINTENANCE' WHERE id=?").run(deviceId);
        ensureFleetSchema(d);d.prepare('INSERT INTO device_events(device_id,action,note,actor,created_at) VALUES(?,?,?,?,?)').run(deviceId,'MAINTENANCE','建立維修保養單並結束目前部署：'+title,me.email,now);
      }
      d.prepare(`INSERT INTO maintenance_orders(id,device_id,type,title,description,status,reported_date,due_date,next_service_date,assignee,vendor,
        lab_snapshot,maintainer_snapshot,responsible_email,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'OPEN',?,?,?,?,?,?,?,?,?,?,?)`).run(
        id,deviceId,p.type,title,description,reported,due,next,assignee,text(p.vendor),loc?.lab_id||'',loc?.maintainer||'',responsible,me.email,now,now);
      entry(d,id,'CREATE',`建立${MAINTENANCE_TYPES[p.type]}紀錄${p.set_maintenance===true?'；設備改為維修中':''}`,me.email,now);
      return {id};
    }
    const order=d.prepare('SELECT * FROM maintenance_orders WHERE id=?').get(text(p.id,80,true));
    if(!order||!allowed(order,me,ctx))throw new MaintenanceError('找不到可存取的維修保養紀錄。',404);
    if(p.action==='note'){
      entry(d,order.id,'NOTE',text(p.content,6000,true),me.email,now);
      d.prepare('UPDATE maintenance_orders SET updated_at=?,version=version+1 WHERE id=?').run(now,order.id);
      return {id:order.id};
    }
    if(p.action!=='update')throw new MaintenanceError('不支援的操作。');
    if(p.version!==order.version)throw new MaintenanceError('紀錄已被更新，請重新載入後再修改。',409);
    if(['COMPLETED','CANCELLED'].includes(order.status))throw new MaintenanceError('已結案的紀錄請以追加說明更正，或另開新單。',409);
    const transitions={OPEN:['OPEN','IN_PROGRESS','CANCELLED'],IN_PROGRESS:['IN_PROGRESS','VERIFY','CANCELLED'],VERIFY:['VERIFY','IN_PROGRESS','COMPLETED','CANCELLED']};
    if(!transitions[order.status]?.includes(p.status))throw new MaintenanceError('請依待處理 → 處理中 → 待驗收 → 已完成流程更新。');
    const result=text(p.result,6000),cost=String(p.cost??'0');
    if(!/^\d{1,9}(\.\d{1,2})?$/.test(cost))throw new MaintenanceError('費用需為非負數，最多兩位小數。');
    if(p.status==='COMPLETED'&&!result)throw new MaintenanceError('完修時請填寫驗收結果與處理方式。');
    if(p.status==='CANCELLED'&&!result)throw new MaintenanceError('取消時請填寫原因。');
    const due=date(p.due_date),next=date(p.next_service_date);
    if(due&&due<order.reported_date)throw new MaintenanceError('預計完成日期不能早於發現日期。');
    const assignee=p.assignee===undefined?order.assignee:text(p.assignee),vendor=p.vendor===undefined?order.vendor:text(p.vendor);
    if(me.role!=='admin'&&assignee!==order.assignee)throw new MaintenanceError('只有管理員可以變更承辦負責人。',403);
    if(assignee&&!d.prepare('SELECT name FROM maintainers WHERE name=?').get(assignee))throw new MaintenanceError('請選擇已建檔的負責人。');
    const responsible=assignee===order.assignee?order.responsible_email:(d.prepare('SELECT email FROM maintainers WHERE name=?').get(assignee)?.email||'');
    if(p.set_standby===true){
      if(me.role!=='admin'||p.status!=='COMPLETED')throw new MaintenanceError('只有管理員可在驗收完成時改為待命。',403);
      if(d.prepare("SELECT 1 FROM maintenance_orders WHERE device_id=? AND id<>? AND status NOT IN ('COMPLETED','CANCELLED')").get(order.device_id,order.id))throw new MaintenanceError('設備仍有其他未結案維修單，無法改為待命。',409);
      if(d.prepare('SELECT status FROM devices WHERE id=?').get(order.device_id)?.status!=='MAINTENANCE')throw new MaintenanceError('設備目前不是維修中，請重新確認。',409);
      if(ctx.current.has(order.device_id))throw new MaintenanceError('設備仍有部署，請先整理部署紀錄。',409);
      d.prepare("UPDATE devices SET status='STANDBY' WHERE id=?").run(order.device_id);
      ensureFleetSchema(d);d.prepare('INSERT INTO device_events(device_id,action,note,actor,created_at) VALUES(?,?,?,?,?)').run(order.device_id,'MAINTENANCE','維修驗收完成，設備改為待命：'+order.title,me.email,now);
    }
    d.prepare('UPDATE maintenance_orders SET status=?,result=?,cost_cents=?,due_date=?,next_service_date=?,assignee=?,vendor=?,responsible_email=?,updated_at=?,completed_at=?,version=version+1 WHERE id=?').run(
      p.status,result,Math.round(Number(cost)*100),due,next,assignee,vendor,responsible,now,['COMPLETED','CANCELLED'].includes(p.status)?now:null,order.id);
    entry(d,order.id,'UPDATE',`${MAINTENANCE_STATUSES[order.status]} → ${MAINTENANCE_STATUSES[p.status]}\n處理結果：${result||'未填'}\n費用：NT$ ${cost}\n承辦負責人：${order.assignee||'未指派'} → ${assignee||'未指派'}；廠商：${vendor||'未填'}\n預計完成：${due||'未設定'}；下次保養：${next||'未設定'}${p.set_standby===true?'\n設備改為待命':''}`,me.email,now);
    return {id:order.id};
  });
}
export function addMaintenanceAttachment(d,me,id,file,data){
  ensureMaintenanceSchema(d);
  if(!data.length||data.length>5*1024*1024)throw new MaintenanceError('每個附件需介於 1 byte 至 5 MB。');
  const mime=data.subarray(0,5).toString()==='%PDF-'?'application/pdf':data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data[0]===255&&data[1]===216&&data[2]===255?'image/jpeg':data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP'?'image/webp':null;
  if(!mime)throw new MaintenanceError('附件只接受 PDF、PNG、JPEG 或 WebP。');
  return transaction(d,()=>{
    const {order}=listMaintenance(d,me,id);
    if(d.prepare('SELECT count(*) AS n FROM maintenance_attachments WHERE order_id=?').get(id).n>=20)throw new MaintenanceError('每張維修單最多 20 個附件。');
    const attachment='ma_'+randomUUID(),now=new Date().toISOString(),name=text(file.name,200,true).replace(/[\r\n\\/]/g,'_');
    d.prepare('INSERT INTO maintenance_attachments(id,order_id,name,mime,size,data,actor,created_at) VALUES(?,?,?,?,?,?,?,?)').run(attachment,order.id,name,mime,data.length,data,me.email,now);
    entry(d,id,'ATTACHMENT','新增附件：'+name,me.email,now);
    d.prepare('UPDATE maintenance_orders SET updated_at=?,version=version+1 WHERE id=?').run(now,id);
    return {id:attachment};
  });
}
export function getMaintenanceAttachment(d,me,id){
  ensureMaintenanceSchema(d);const file=d.prepare('SELECT * FROM maintenance_attachments WHERE id=?').get(id);
  if(!file)throw new MaintenanceError('附件不存在。',404);
  listMaintenance(d,me,file.order_id);return file;
}
