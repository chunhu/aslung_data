import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureMaintenanceSchema,listMaintenance,saveMaintenance,addMaintenanceAttachment,getMaintenanceAttachment} from '../lib/maintenance.mjs';
const admin={role:'admin',email:'admin@test'},tech={role:'member',email:'tech@test',name:'維護甲'},other={role:'member',email:'reader@test',name:'維護甲'};
function database(){const d=new DatabaseSync(':memory:');d.exec(`PRAGMA foreign_keys=ON;
  CREATE TABLE devices(id TEXT PRIMARY KEY,status TEXT);INSERT INTO devices VALUES('AL-1','DEPLOYED'),('AL-2','STANDBY');
  CREATE TABLE maintainers(name TEXT PRIMARY KEY,email TEXT);INSERT INTO maintainers VALUES('維護甲','tech@test');
  CREATE TABLE device_locations(id INTEGER PRIMARY KEY,aslung_id TEXT REFERENCES devices(id),lab_id TEXT,maintainer TEXT,start_time TEXT,end_time TEXT,active INTEGER);
  INSERT INTO device_locations VALUES(1,'AL-1','N1','維護甲','2020-01-01',NULL,1);`);ensureMaintenanceSchema(d);return d;}
const payload={action:'create',device_id:'AL-1',type:'REPAIR',title:'風扇異音',description:'啟動時發出異音',reported_date:'2026-10-15',assignee:'維護甲'};
const update=(order,status,extra={})=>({action:'update',id:order.id,version:order.version,status,result:'更換風扇並驗收通過',cost:'1200.50',...extra});

test('creation snapshots deployment; completing a repair preserves history and does not redeploy',()=>{
  const d=database();try{
    const {id}=saveMaintenance(d,admin,{...payload,set_maintenance:true});
    let {order}=listMaintenance(d,admin,id);
    assert.equal(order.lab_snapshot,'N1');assert.equal(order.maintainer_snapshot,'維護甲');
    assert.equal(d.prepare('SELECT status FROM devices WHERE id=?').get('AL-1').status,'MAINTENANCE');
    assert.equal(d.prepare('SELECT active FROM device_locations').get().active,0);
    assert.throws(()=>saveMaintenance(d,admin,update(order,'COMPLETED')),/流程/);
    for(const status of ['IN_PROGRESS','VERIFY','COMPLETED']){
      saveMaintenance(d,admin,update(order,status,{set_standby:status==='COMPLETED'}));order=listMaintenance(d,admin,id).order;
    }
    assert.equal(order.cost_cents,120050);assert.equal(order.status,'COMPLETED');assert.ok(order.completed_at);
    assert.equal(d.prepare('SELECT status FROM devices WHERE id=?').get('AL-1').status,'STANDBY');
    assert.equal(listMaintenance(d,admin,id).entries.length,4);
    assert.equal(d.prepare('SELECT count(*) AS n FROM device_events').get().n,2);
    assert.throws(()=>saveMaintenance(d,admin,update(order,'OPEN')),/結案/);
    saveMaintenance(d,admin,{action:'note',id,content:'追加保養說明'});
    assert.equal(listMaintenance(d,admin,id).entries.at(-1).content,'追加保養說明');
    assert.throws(()=>d.prepare('DELETE FROM devices WHERE id=?').run('AL-1'),/FOREIGN KEY/);
  }finally{d.close();}
});

test('verified maintainer email grants only responsible device records; display name and data grants do not',()=>{
  const d=database();try{
    assert.equal(listMaintenance(d,other).canUse,false);
    assert.equal(listMaintenance(d,tech).devices[0].id,'AL-1');
    const {id}=saveMaintenance(d,tech,payload);
    assert.throws(()=>saveMaintenance(d,other,payload),e=>e.status===403);
    assert.throws(()=>saveMaintenance(d,tech,{...payload,device_id:'AL-2'}),e=>e.status===403);
    assert.throws(()=>listMaintenance(d,other,id),e=>e.status===404);
    assert.equal(listMaintenance(d,other).orders.length,0);
    d.prepare("UPDATE device_locations SET active=0,end_time='2026-10-16' WHERE id=1").run();
    assert.equal(listMaintenance(d,tech,id).order.id,id); // Original responsible person keeps this ticket's history.
    assert.throws(()=>saveMaintenance(d,tech,{...payload,set_maintenance:true}),e=>e.status===403);
  }finally{d.close();}
});

test('concurrent writes, invalid dates/costs, and forbidden equipment changes are atomic',()=>{
  const d=database();try{
    for(const invalid of [{reported_date:'2026-02-30'},{due_date:'2026-01-01'},{type:'other'},{assignee:'陌生人'}])assert.throws(()=>saveMaintenance(d,admin,{...payload,...invalid}));
    assert.equal(listMaintenance(d,admin).orders.length,0);
    const {id}=saveMaintenance(d,admin,payload),order=listMaintenance(d,admin,id).order;
    saveMaintenance(d,tech,{action:'note',id,content:'已收到設備'});
    assert.throws(()=>saveMaintenance(d,admin,update(order,'IN_PROGRESS')),e=>e.status===409);
    const fresh=listMaintenance(d,admin,id).order;
    for(const cost of ['-1','NaN','1.234','1e4'])assert.throws(()=>saveMaintenance(d,admin,update(fresh,'IN_PROGRESS',{cost})));
    assert.equal(listMaintenance(d,admin,id).order.status,'OPEN');
    assert.equal(listMaintenance(d,admin,id).entries.length,2);
    assert.throws(()=>saveMaintenance(d,tech,update(fresh,'IN_PROGRESS',{set_standby:true})),e=>e.status===403);
  }finally{d.close();}
});

test('private attachments validate actual file bytes, size, ownership and limit, and stay in SQLite backups',()=>{
  const d=database();try{
    const {id}=saveMaintenance(d,admin,payload),bytes=Buffer.from('%PDF-1.7\nfixture');
    assert.throws(()=>addMaintenanceAttachment(d,other,id,{name:'x.pdf'},bytes),e=>e.status===404);
    assert.throws(()=>addMaintenanceAttachment(d,admin,id,{name:'x.pdf'},Buffer.from('<script>bad</script>')),/只接受/);
    assert.throws(()=>addMaintenanceAttachment(d,admin,id,{name:'x.pdf'},Buffer.alloc(5*1024*1024+1)),/5 MB/);
    const file=addMaintenanceAttachment(d,tech,id,{name:'report.pdf'},bytes);
    assert.deepEqual(Buffer.from(getMaintenanceAttachment(d,tech,file.id).data),bytes);
    assert.throws(()=>getMaintenanceAttachment(d,other,file.id),e=>e.status===404);
    assert.equal(listMaintenance(d,admin,id).attachments[0].data,undefined);
    for(let i=1;i<20;i++)addMaintenanceAttachment(d,admin,id,{name:'report.pdf'},bytes);
    assert.throws(()=>addMaintenanceAttachment(d,admin,id,{name:'report.pdf'},bytes),/20/);
    assert.equal(listMaintenance(d,admin,id).attachments.length,20);
  }finally{d.close();}
});

test('another open ticket prevents returning equipment to standby',()=>{
  const d=database();try{
    const {id}=saveMaintenance(d,admin,{...payload,set_maintenance:true});saveMaintenance(d,admin,payload);
    for(const status of ['IN_PROGRESS','VERIFY'])saveMaintenance(d,admin,update(listMaintenance(d,admin,id).order,status));
    assert.throws(()=>saveMaintenance(d,admin,update(listMaintenance(d,admin,id).order,'COMPLETED',{set_standby:true})),/其他未結案/);
    assert.equal(listMaintenance(d,admin,id).order.status,'VERIFY');
    assert.equal(d.prepare('SELECT status FROM devices WHERE id=?').get('AL-1').status,'MAINTENANCE');
  }finally{d.close();}
});
