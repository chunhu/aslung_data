import {FleetError,ensureFleetSchema} from './fleet-store.mjs';
import {DEVICE_STATUSES,quickDeviceSnapshot} from './fleet.mjs';
import {saveMaintenance,MaintenanceError} from './maintenance.mjs';

export function quickUpdateDevice(d,p,actor){
  if(typeof p.id!=='string'||!p.id||p.id.length>80||!['status','location','maintainer'].includes(p.field))throw new FleetError('快速更新參數無效。');
  if(typeof p.expected!=='string'||p.expected.length>20000)throw new FleetError('請重新整理設備後再操作。',409);
  if(p.note!=null&&(typeof p.note!=='string'||p.note.trim().length>1000))throw new FleetError('異動說明最多 1,000 字。');
  const note=(p.note||'').trim(),now=new Date().toISOString();
  ensureFleetSchema(d);d.exec('BEGIN IMMEDIATE');
  try{
    const device=d.prepare('SELECT * FROM devices WHERE id=?').get(p.id);
    if(!device)throw new FleetError('設備已不存在。',404);
    const history=d.prepare('SELECT * FROM device_locations WHERE aslung_id=? ORDER BY id').all(p.id);
    if(quickDeviceSnapshot(device,history)!==p.expected)throw new FleetError('設備狀態、地點或負責人已被更新，請重新整理後再操作。',409);
    const active=history.filter(l=>l.active&&!l.end_time);
    if(active.length>1||active.some(l=>!Number.isFinite(Date.parse(l.start_time))||Date.parse(l.start_time)>Date.now()))throw new FleetError('含重複、未來或日期異常的部署，請先使用原編輯功能整理。',409);
    const current=active[0];let message='',maintenanceId;
    const status=p.field==='location'?'DEPLOYED':p.status;
    if(p.field==='maintainer'){
      if(!current)throw new FleetError('未部署設備請先選擇地點並建立部署。');
      const name=maintainer(d,p.maintainer);
      if(name===(current.maintainer||''))throw new FleetError('負責人未變更。');
      d.prepare('UPDATE device_locations SET maintainer=? WHERE id=?').run(name,current.id);
      message=`負責人：${current.maintainer||'未指派'} → ${name||'未指派'}`;
    }else if(p.field==='location'||status==='DEPLOYED'){
      if(device.status==='RETIRED'||device.status==='LOST')throw new FleetError('報廢或遺失設備請先透過原編輯方式確認恢復狀態。');
      if(d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_orders'").get()
        &&d.prepare("SELECT 1 FROM maintenance_orders WHERE device_id=? AND status NOT IN ('COMPLETED','CANCELLED')").get(p.id))throw new FleetError('尚有未結案維修保養單，請先確認完修或取消後再部署。',409);
      if(typeof p.lab_id!=='string'||!d.prepare('SELECT id FROM labs WHERE id=?').get(p.lab_id))throw new FleetError('請從地點庫選擇有效地點。');
      const name=maintainer(d,p.maintainer);
      if(typeof p.start_time!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(p.start_time)||!Number.isFinite(Date.parse(p.start_time))||new Date(p.start_time.slice(0,10)).toISOString().slice(0,10)!==p.start_time.slice(0,10))throw new FleetError('請填寫含時區的有效生效時間。');
      const time=new Date(p.start_time).toISOString(),ms=Date.parse(time);
      if(ms>Date.now()+5000)throw new FleetError('快速移轉不接受未來時間，請於實際部署時更新。');
      if(current&&ms<Date.parse(current.start_time))throw new FleetError('生效時間不能早於目前部署的開始時間。');
      if(history.some(l=>l!==current&&(Date.parse(l.start_time)>=ms||(l.end_time&&Date.parse(l.end_time)>ms))))throw new FleetError('生效時間與既有歷史紀錄重疊，請使用原編輯方式確認。');
      if(current?.lab_id===p.lab_id)throw new FleetError('地點未變更；如只調整負責人，請點擊負責人欄位。');
      if(current)d.prepare('UPDATE device_locations SET active=0,end_time=? WHERE id=?').run(time,current.id);
      d.prepare('INSERT INTO device_locations(aslung_id,lab_id,maintainer,start_time,active) VALUES(?,?,?,?,1)').run(p.id,p.lab_id,name,time);
      d.prepare("UPDATE devices SET status='DEPLOYED',location=? WHERE id=?").run(p.lab_id,p.id);
      message=`部署：${current?.lab_id||'未部署'} → ${p.lab_id}；負責人：${name||'未指派'}；生效：${time}`;
    }else{
      if(!Object.hasOwn(DEVICE_STATUSES,status)||status==='DEPLOYED')throw new FleetError('請選擇有效設備狀態。');
      if(status===device.status)throw new FleetError('設備狀態未變更。');
      if(status==='STANDBY'&&d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='maintenance_orders'").get()
        &&d.prepare("SELECT 1 FROM maintenance_orders WHERE device_id=? AND status NOT IN ('COMPLETED','CANCELLED')").get(p.id))throw new FleetError('尚有未結案維修保養單，請先確認完修或取消後再改為待命。',409);
      if(status==='MAINTENANCE'&&p.create_maintenance===true){
        const result=saveMaintenance(d,{role:'admin',email:actor},{action:'create',device_id:p.id,type:'REPAIR',title:p.repair_title,description:p.repair_description,
          reported_date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date()),assignee:current?.maintainer||'',set_maintenance:true});
        maintenanceId=result.id;
      }else{
        d.prepare("UPDATE device_locations SET active=0,end_time=? WHERE aslung_id=? AND active=1 AND (end_time IS NULL OR end_time='')").run(now,p.id);
        d.prepare('UPDATE devices SET status=? WHERE id=?').run(status,p.id);
      }
      message=`狀態：${DEVICE_STATUSES[device.status]||device.status} → ${DEVICE_STATUSES[status]}${current?'；結束部署 '+current.lab_id:''}${maintenanceId?'；已建立維修單':''}`;
    }
    d.prepare('INSERT INTO device_events(device_id,action,note,actor,created_at) VALUES(?,?,?,?,?)').run(p.id,'QUICK_UPDATE',message+(note?'；'+note:''),actor,now);
    d.exec('COMMIT');return {updated:1,maintenanceId};
  }catch(e){d.exec('ROLLBACK');if(e instanceof MaintenanceError)throw new FleetError(e.message,e.status);throw e;}
}
function maintainer(d,value){
  if(value==null||value==='')return '';
  if(typeof value!=='string'||!d.prepare('SELECT name FROM maintainers WHERE name=?').get(value))throw new FleetError('請從維護人員名單選擇有效負責人。');
  return value;
}
