import {isCurrentDeployment} from './device-deployments.mjs';

export const DEVICE_STATUSES = {DEPLOYED:'使用中', STANDBY:'待命中', MAINTENANCE:'維修中', RETIRED:'已報廢', LOST:'遺失'};
export const EMPTY_FLEET_FILTER = {search:'',status:'ALL',health:'ALL',lab:'ALL',maintainer:'ALL',issue:'ALL',grant:'ALL'};

export function quickDeviceSnapshot(device,locations){
  return JSON.stringify([device.status,locations.filter(l=>l.aslung_id===device.id&&l.active&&!l.end_time)
    .map(l=>[l.id,l.lab_id,l.maintainer||'',l.start_time]).sort((a,b)=>Number(a[0])-Number(b[0]))]);
}

export function buildFleetRows(devices, locations, readings, labs = [], thresholdMins = 60, now = Date.now()) {
  const byDevice = new Map(), latest = new Map((readings || []).map(r=>[r.aslung_id,r]));
  const labMap = new Map(labs.map(l=>[l.id,l]));
  for(const location of locations) {
    const list=byDevice.get(location.aslung_id)||[];
    list.push(location);byDevice.set(location.aslung_id,list);
  }
  return devices.map(device=>{
    const history=(byDevice.get(device.id)||[]).sort((a,b)=>Date.parse(b.start_time)-Date.parse(a.start_time)||b.id-a.id);
    const active=history.filter(l=>isCurrentDeployment(l,now)), current=active[0];
    const lab=current?.lab_id||'', labInfo=labMap.get(lab), reading=latest.get(device.id);
    const timestamp=reading?.timestamp, time=Date.parse(timestamp);
    const health=readings===null?'UNKNOWN':!reading?'NODATA':!Number.isFinite(time)||time>now+300000?'UNKNOWN':now-time>=thresholdMins*60000?'OFFLINE':'ONLINE';
    const issues=[];
    if(active.length>1)issues.push('重複部署');
    if(device.status==='DEPLOYED'&&!current)issues.push('缺少部署');
    if(current&&!current.maintainer?.trim())issues.push('未指派負責人');
    if(current&&!labInfo)issues.push('地點未建檔');
    if(history.some(l=>!Number.isFinite(Date.parse(l.start_time))||(l.end_time&&(!Number.isFinite(Date.parse(l.end_time))||Date.parse(l.end_time)<Date.parse(l.start_time)))))issues.push('日期異常');
    return {...device,current,history,lab,labName:labInfo?.location_name||lab,maintainer:current?.maintainer||'',lastSeen:timestamp||null,health,issues};
  });
}

export function filterFleetRows(rows, filter) {
  const query=filter.search.trim().toLocaleLowerCase();
  return rows.filter(r=>(filter.status==='ALL'||r.status===filter.status)
    &&(filter.health==='ALL'||r.health===filter.health)
    &&(filter.lab==='ALL'||r.lab===filter.lab||(filter.lab==='UNASSIGNED'&&!r.lab))
    &&(filter.maintainer==='ALL'||r.maintainer===filter.maintainer||(filter.maintainer==='UNASSIGNED'&&!r.maintainer))
    &&(filter.issue==='ALL'||(filter.issue==='ANY'?r.issues.length>0:r.issues.includes(filter.issue)))
    &&(filter.grant==='ALL'||(filter.grant==='GRANTED'?r.grantCount>0:!r.grantCount))
    &&(!query||[r.id,r.description,r.lab,r.labName,r.maintainer].join(' ').toLocaleLowerCase().includes(query)));
}

export function fleetCsv(rows) {
  const cell=value=>{
    const text=String(value??'');
    return '"'+(/^[\s]*[=+@-]/.test(text)?"'"+text:text).replaceAll('"','""')+'"';
  };
  return '\uFEFF'+[['設備編號','狀態','目前地點','負責人','最後上傳','連線狀態','資料提醒','備註'],
    ...rows.map(r=>[r.id,DEVICE_STATUSES[r.status]||r.status,r.lab,r.maintainer,r.lastSeen,r.health,r.issues.join('、'),r.description])]
    .map(row=>row.map(cell).join(',')).join('\r\n');
}
