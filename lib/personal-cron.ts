import {getConnection} from './store.mjs';
import {ensurePersonalSchema,syncPersonalSource} from './personal-calibration.mjs';
import {fetchCalibrationCsv} from './calibration-google.mjs';
export async function checkPersonalSources(){
  const d=getConnection();ensurePersonalSchema(d);
  const due=d.prepare(`SELECT s.id,s.email,m.role FROM personal_sources s JOIN members m ON m.email=s.email
    WHERE m.active=1 AND m.role IN ('member','admin') AND s.kind='GOOGLE' AND s.archived=0 AND s.enabled=1
    AND s.auto_sync=1 AND (s.manual=0 OR s.allow_overwrite=1) AND s.next_check<=? AND s.lease_until<=?
    ORDER BY s.next_check LIMIT 10`).all(new Date().toISOString(),Date.now());
  for(const s of due)await syncPersonalSource(d,{email:s.email,role:s.role},s.id,fetchCalibrationCsv,{scheduled:true});
}
export function initPersonalCron(){
  const state=globalThis as typeof globalThis&{aslungPersonalCron?:ReturnType<typeof setInterval>;aslungPersonalRunning?:boolean};
  if(state.aslungPersonalCron)return;
  state.aslungPersonalCron=setInterval(()=>{if(state.aslungPersonalRunning)return;state.aslungPersonalRunning=true;void checkPersonalSources().catch(()=>console.error('[Personal calibration] 自動同步失敗')).finally(()=>{state.aslungPersonalRunning=false;});},60000);
  state.aslungPersonalCron.unref();
}
