import {getConnection} from './store.mjs';
import {ensureCalibrationSchema,syncCalibrationSource} from './calibration.mjs';
import {fetchCalibrationCsv} from './calibration-google.mjs';

export async function checkCalibrationSources(){
  const d=getConnection();ensureCalibrationSchema(d);
  const due=d.prepare('SELECT id FROM calibration_sources WHERE enabled=1 AND next_check<=? AND lease_until<=? ORDER BY next_check LIMIT 20').all(new Date().toISOString(),Date.now());
  for(const source of due)await syncCalibrationSource(d,source.id,'scheduler',fetchCalibrationCsv);
}
export function initCalibrationCron(){
  const state=globalThis as typeof globalThis&{aslungCalibrationCron?:ReturnType<typeof setInterval>};
  if(state.aslungCalibrationCron)return;
  state.aslungCalibrationCron=setInterval(()=>{void checkCalibrationSources().catch(()=>console.error('[Calibration] 自動同步失敗，請查看校正來源設定。'));},60000);
  state.aslungCalibrationCron.unref();
}
