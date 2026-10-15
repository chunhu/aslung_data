import {createHash} from 'node:crypto';
import {analyzeImport} from './fleet-import.mjs';
import {DEVICE_STATUSES} from './fleet.mjs';

export class FleetError extends Error {constructor(message,status=400){super(message);this.status=status;}}
export function ensureFleetSchema(d) {
  d.exec(`CREATE TABLE IF NOT EXISTS device_events(
    id INTEGER PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    action TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS device_events_device_time ON device_events(device_id,created_at);`);
}
const event=(d,id,action,note,actor,now)=>d.prepare('INSERT INTO device_events(device_id,action,note,actor,created_at) VALUES(?,?,?,?,?)').run(id,action,note,actor,now);

export function updateFleetDevices(d,p,actor) {
  ensureFleetSchema(d);
  if(!Array.isArray(p.ids)||!p.ids.length||p.ids.length>1000)throw new FleetError('請選取 1 至 1,000 台設備。');
  const ids=[...new Set(p.ids)];
  if(ids.some(id=>typeof id!=='string'||id.length>80))throw new FleetError('設備編號不正確。');
  if(!['status','maintainer'].includes(p.operation))throw new FleetError('批次操作不正確。');
  if(p.operation==='status'&&!['STANDBY','MAINTENANCE','RETIRED','LOST'].includes(p.value))throw new FleetError('請選擇有效狀態；恢復使用請建立部署紀錄。');
  if(p.operation==='maintainer'&&(!p.value||typeof p.value!=='string'||!d.prepare('SELECT name FROM maintainers WHERE name=?').get(p.value)))throw new FleetError('請選擇已建檔的負責人。');
  const now=new Date().toISOString(),note=String(p.note||'').trim().slice(0,1000);
  d.exec('BEGIN IMMEDIATE');
  try {
    for(const id of ids){
      const device=d.prepare('SELECT * FROM devices WHERE id=?').get(id);
      if(!device)throw new FleetError(`設備 ${id} 已不存在，請重新整理。`,409);
      const active=d.prepare("SELECT * FROM device_locations WHERE aslung_id=? AND active=1 AND (end_time IS NULL OR end_time='')").all(id);
      if(active.some(l=>Date.parse(l.start_time)>Date.now()))throw new FleetError(`${id} 含未來部署，請先確認部署日期。`);
      if(p.operation==='maintainer'){
        if(active.length!==1)throw new FleetError(`${id} 必須有且僅有一筆使用中部署，才能指派負責人。`);
        d.prepare('UPDATE device_locations SET maintainer=? WHERE id=?').run(p.value,active[0].id);
        event(d,id,'MAINTAINER',`${active[0].maintainer||'未指派'} → ${p.value}${note?'；'+note:''}`,actor,now);
      }else{
        d.prepare("UPDATE device_locations SET active=0,end_time=? WHERE aslung_id=? AND active=1 AND (end_time IS NULL OR end_time='')").run(now,id);
        d.prepare('UPDATE devices SET status=? WHERE id=?').run(p.value,id);
        event(d,id,'STATUS',`${DEVICE_STATUSES[device.status]||device.status} → ${DEVICE_STATUSES[p.value]}${note?'；'+note:''}`,actor,now);
      }
    }
    d.exec('COMMIT');return {updated:ids.length};
  }catch(e){d.exec('ROLLBACK');throw e;}
}

export function previewFleetImport(d,p) {
  if(typeof p.text!=='string'||!p.text.trim()||p.text.length>2000000)throw new FleetError('請提供不超過 2 MB 的 CSV 或貼上資料。');
  let parsed;
  try{parsed=analyzeImport(p.text,p.mapping,p.onlyAslung!==false);}catch(e){throw new FleetError(e.message);}
  const existing=d.prepare('SELECT * FROM device_locations ORDER BY id').all(),devices=d.prepare('SELECT id FROM devices ORDER BY id').all();
  const labs=new Set(d.prepare('SELECT id FROM labs').all().map(l=>l.id));
  const maintainers=new Set(d.prepare('SELECT name FROM maintainers').all().map(m=>m.name));
  const matching=new Map(existing.map(l=>[JSON.stringify([l.lab_id,l.aslung_id,l.start_time]),l]));
  const keyCounts=new Map();
  for(const l of existing){const key=JSON.stringify([l.lab_id,l.aslung_id,l.start_time]);keyCounts.set(key,(keyCounts.get(key)||0)+1);}
  let added=0,updated=0,unchanged=0;
  const records=parsed.records.map(r=>{
    const old=matching.get(JSON.stringify([r.lab_id,r.aslung_id,r.start_time]));
    const change=!old?'新增':(String(old.maintainer||'')===r.maintainer&&(old.end_time||null)===r.end_time&&Number(old.active)===r.active)?'不變':'更新';
    if(change==='新增')added++;else if(change==='更新')updated++;else unchanged++;
    if(!labs.has(r.lab_id))parsed.issues.push({row:r.row,level:'warning',message:`地點 ${r.lab_id} 尚未建檔，請確認地點編號。`});
    if(r.maintainer&&!maintainers.has(r.maintainer))parsed.issues.push({row:r.row,level:'warning',message:`負責人「${r.maintainer}」尚未建檔，請先確認聯絡資料。`});
    if(old?.maintainer&&!r.maintainer)parsed.issues.push({row:r.row,level:'warning',message:`此列將清空既有負責人「${old.maintainer}」。`});
    if(keyCounts.get(JSON.stringify([r.lab_id,r.aslung_id,r.start_time]))>1)parsed.issues.push({row:r.row,level:'error',message:'既有資料有多筆相同部署，請先至設備追蹤整理重複紀錄。'});
    return {...r,change};
  });
  const merged=new Map(existing.map(l=>[JSON.stringify([l.lab_id,l.aslung_id,l.start_time]),l]));
  for(const r of records)merged.set(JSON.stringify([r.lab_id,r.aslung_id,r.start_time]),r);
  const activeCounts=new Map();
  const byDevice=new Map();
  for(const r of merged.values()){const list=byDevice.get(r.aslung_id)||[];list.push(r);byDevice.set(r.aslung_id,list);}
  for(const r of merged.values())if(r.active&&!r.end_time)activeCounts.set(r.aslung_id,(activeCounts.get(r.aslung_id)||0)+1);
  for(const r of records)if(r.active&&!r.end_time&&activeCounts.get(r.aslung_id)>1)
    parsed.issues.push({row:r.row,level:'error',message:`${r.aslung_id} 將有多筆使用中部署，請填寫舊部署結束日期。`});
  for(const r of records){
    if(r.change==='不變')continue;
    const key=JSON.stringify([r.lab_id,r.aslung_id,r.start_time]);
    const overlaps=(byDevice.get(r.aslung_id)||[]).some(other=>{
      if(JSON.stringify([other.lab_id,other.aslung_id,other.start_time])===key)return false;
      if(!other.active&&!other.end_time)return false;
      const end=r.end_time?Date.parse(r.end_time):r.active?Infinity:Date.parse(r.start_time);
      const otherEnd=other.end_time?Date.parse(other.end_time):Infinity;
      return Date.parse(r.start_time)<otherEnd&&Date.parse(other.start_time)<end;
    });
    if(overlaps)parsed.issues.push({row:r.row,level:'warning',message:`${r.aslung_id} 的部署期間與其他紀錄重疊，請確認日期與地點。`});
  }
  const known=new Set(devices.map(d=>d.id));
  const newDevices=new Set(records.filter(r=>!known.has(r.aslung_id)).map(r=>r.aslung_id)).size;
  const fingerprint=createHash('sha256').update(JSON.stringify({records,existing,devices})).digest('hex');
  return {...parsed,records,added,updated,unchanged,newDevices,fingerprint,canApply:records.length>0&&!parsed.issues.some(i=>i.level==='error')};
}

export function applyFleetImport(d,p,actor) {
  ensureFleetSchema(d);d.exec('BEGIN IMMEDIATE');
  try {
    const preview=previewFleetImport(d,p);
    if(!preview.canApply)throw new FleetError('預覽中仍有錯誤，請修正後再套用。');
    if(preview.fingerprint!==p.fingerprint)throw new FleetError('資料已異動，請重新預覽後再套用。',409);
    const now=new Date().toISOString();
    for(const r of preview.records){
      if(r.change==='不變')continue;
      d.prepare("INSERT INTO devices(id,name,location,description,status) VALUES(?,'','','','STANDBY') ON CONFLICT(id) DO NOTHING").run(r.aslung_id);
      const old=d.prepare('SELECT id FROM device_locations WHERE lab_id=? AND aslung_id=? AND start_time=?').get(r.lab_id,r.aslung_id,r.start_time);
      if(old)d.prepare('UPDATE device_locations SET maintainer=?,end_time=?,active=? WHERE id=?').run(r.maintainer,r.end_time,r.active,old.id);
      else d.prepare('INSERT INTO device_locations(lab_id,aslung_id,maintainer,start_time,end_time,active) VALUES(?,?,?,?,?,?)').run(r.lab_id,r.aslung_id,r.maintainer,r.start_time,r.end_time,r.active);
      event(d,r.aslung_id,'IMPORT',`${r.change}部署：${r.lab_id}；${r.start_time}；負責人：${r.maintainer||'未指派'}`,actor,now);
    }
    d.exec('COMMIT');return {added:preview.added,updated:preview.updated,unchanged:preview.unchanged};
  }catch(e){d.exec('ROLLBACK');throw e;}
}
