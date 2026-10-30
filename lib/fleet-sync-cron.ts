import {getConnection,getStore} from './store.mjs';
import {ensureFleetSyncSchema,syncFleetSchedule} from './fleet-sync.mjs';
import {syncDeviceStatusesAndLocations} from './server';
export async function checkFleetSchedules(){
  const d=getConnection();ensureFleetSyncSchema(d);
  const sources=d.prepare('SELECT id FROM fleet_sync_sources WHERE enabled=1 AND next_check<=? AND lease_until<=? ORDER BY next_check LIMIT 10').all(new Date().toISOString(),Date.now());
  for(const s of sources){const result=await syncFleetSchedule(d,s.id);if(result.status==='SUCCESS')await syncDeviceStatusesAndLocations(getStore());}
}
export function initFleetSyncCron(){
  const state=globalThis as typeof globalThis&{aslungFleetSyncCron?:ReturnType<typeof setInterval>;aslungFleetSyncRunning?:boolean};
  if(state.aslungFleetSyncCron)return;
  state.aslungFleetSyncCron=setInterval(()=>{if(state.aslungFleetSyncRunning)return;state.aslungFleetSyncRunning=true;void checkFleetSchedules().catch(()=>console.error('[Fleet] 試算表定期同步失敗')).finally(()=>{state.aslungFleetSyncRunning=false;});},60000);
  state.aslungFleetSyncCron.unref();
}
