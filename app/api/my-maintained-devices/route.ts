import {identity,fail} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {getPool} from '@/lib/data';
import {MaintainerLinkError,myMaintainedDevices,connectionStatus} from '@/lib/maintainer-links.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:Request){try{
  const me=await identity(req),d=getConnection(),now=new Date();
  const owned=myMaintainedDevices(d,me,now);
  const setting=d.prepare('SELECT offline_threshold_mins FROM alert_settings WHERE id=1').get();
  const threshold=Math.max(5,Number(setting?.offline_threshold_mins)||60),devices:any[]=[];
  for(let offset=0;offset<owned.devices.length;offset+=8){
    const rows=await Promise.all(owned.devices.slice(offset,offset+8).map(async device=>{
      try{
        const [records]=await getPool().query({sql:'SELECT time FROM rawdata WHERE uid=? ORDER BY time DESC,id DESC LIMIT 1',values:[device.id],timeout:20000});
        const last=(records as any[])[0]?.time;
        const text=String(last||'').replace(' ','T');
        return {...device,...connectionStatus(last instanceof Date?last:last?new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(text)?text:text+'Z'):null,threshold)};
      }catch{return {...device,status:'UNKNOWN',last_seen:null,offline_mins:null,email_exclusion:'資料查詢失敗，未判定為斷線'};}
    }));devices.push(...rows);
  }
  // Recheck scope after remote reads: unlinks and handovers take effect immediately.
  const current=myMaintainedDevices(d,me,new Date()),ids=new Set(current.devices.map(r=>r.id));
  const visible=devices.filter(r=>ids.has(r.id)&&current.devices.some(x=>x.id===r.id&&x.maintainer_id===r.maintainer_id&&x.start===r.start));
  const summary={total:visible.length,online:0,offline:0,no_data:0,unknown:0};
  for(const row of visible){if(row.status==='ONLINE')summary.online++;else if(row.status==='OFFLINE')summary.offline++;else if(row.status==='NO_DATA')summary.no_data++;else summary.unknown++;}
  return Response.json({identities:current.identities,devices:visible,summary,threshold_mins:threshold,alert_email_enabled:current.alert_email_enabled,checked_at:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
}catch(e){return e instanceof MaintainerLinkError?Response.json({error:e.message},{status:e.status,headers:{'Cache-Control':'no-store'}}):fail(e);}}
