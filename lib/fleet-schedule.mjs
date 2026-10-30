import {FleetError} from './fleet-store.mjs';
export function normalizeFleetSchedule(p){
  const type=p.scheduleType??'interval';let time=p.scheduleTime??'02:00',days=p.scheduleDays??'1,2,3,4,5';
  if(!['interval','daily','weekly'].includes(type))throw new FleetError('請選擇固定間隔、每天固定時間或每週固定時間。');
  const interval=p.intervalMins??60;
  if(type==='interval'&&(!Number.isInteger(interval)||interval<1||interval>10080))throw new FleetError('同步週期請填 1 至 10080 分鐘的整數。');
  if(typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){if(type!=='interval')throw new FleetError('同步時間請填有效的 HH:mm。');time='02:00';}
  if(typeof days!=='string'||!/^\d(?:,\d)*$/.test(days)||days.split(',').some(d=>Number(d)>6)){if(type==='weekly')throw new FleetError('每週同步請至少選擇一天（週日為 0，週六為 6）。');days='1,2,3,4,5';}
  return {type,time,days:[...new Set(days.split(',').map(Number))].sort().join(','),interval:Number.isInteger(interval)&&interval>=1&&interval<=10080?interval:60};
}
export function nextFleetSchedule(config,now=new Date()){
  if(config.type==='interval')return new Date(now.getTime()+config.interval*60000).toISOString();
  const local=new Date(now.getTime()+8*3600000),[hours,minutes]=config.time.split(':').map(Number),days=new Set(config.days.split(',').map(Number));
  for(let offset=0;offset<=7;offset++){
    const day=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+offset));
    const target=day.getTime()+(hours*60+minutes)*60000-8*3600000;
    if(target>now.getTime()&&(config.type==='daily'||days.has(day.getUTCDay())))return new Date(target).toISOString();
  }
  throw new FleetError('無法計算下次同步時間。');
}
export function fleetScheduleLabel(config){
  if(config.type==='interval')return `每 ${config.interval} 分鐘`;
  if(config.type==='daily')return `每天 ${config.time}（Asia/Taipei）`;
  return `每週${config.days.split(',').map(d=>'日一二三四五六'[Number(d)]).join('、')} ${config.time}（Asia/Taipei）`;
}
