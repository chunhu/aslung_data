import {rangeTime as parseRangeTime} from './download-segments.mjs';
const rangeTime=(value,fallback)=>parseRangeTime(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00':value,fallback);

export const grantOnlyRealtime=member=>['member','viewer'].includes(member?.role);
// Explicit current grants only. Being a maintainer, owning a device, or having
// a historical download interval does not grant researchers live access.
export async function currentRealtimeGrants(read,member,now=Date.now()){
  const grants=(await read('SELECT * FROM grants WHERE LOWER(email)=LOWER(?)',[member.email])).filter(grant=>{
    const start=rangeTime(grant.start,NaN),end=rangeTime(grant.end,Infinity);
    return Number.isFinite(start)&&!Number.isNaN(end)&&start<=now&&now<=end;
  });
  const access=new Map();if(!grants.length)return access;
  const devices=await read('SELECT * FROM devices',[]);
  const locations=grants.some(grant=>grant.grant_type==='lab')?await read('SELECT * FROM device_locations',[]):[];
  const latest=new Map();
  for(const location of locations){
    const start=rangeTime(location.start_time,NaN),previous=latest.get(location.aslung_id);
    if(!Number.isFinite(start)||start>now)continue;
    if(!previous||start>previous.start||start===previous.start&&Number(location.id)>Number(previous.row.id))latest.set(location.aslung_id,{start,row:location});
  }
  const hasHistory=new Set(locations.map(row=>row.aslung_id));
  for(const device of devices)for(const grant of grants){
    let start=rangeTime(grant.start,NaN),end=rangeTime(grant.end,Infinity);
    if(grant.grant_type==='lab'){
      const current=latest.get(device.id)?.row;
      if(hasHistory.has(device.id)){
        if(!current||current.lab_id!==grant.lab_id||Number(current.active)!==1)continue;
        const until=rangeTime(current.end_time,Infinity);if(Number.isNaN(until)||now>=until)continue;
        start=Math.max(start,rangeTime(current.start_time,NaN));end=Math.min(end,until);
      }else if(device.location!==grant.lab_id||!['DEPLOYED','',null,undefined].includes(device.status))continue;
    }else if(grant.device_id!==device.id)continue;
    if(!Number.isFinite(start)||Number.isNaN(end)||start>end)continue;
    if(!access.has(device.id))access.set(device.id,[]);
    access.get(device.id).push({start,end});
  }
  return access;
}
export function canReadRealtime(access,id,instant){
  return Number.isFinite(instant)&&(access.get(id)||[]).some(range=>range.start<=instant&&instant<=range.end);
}
