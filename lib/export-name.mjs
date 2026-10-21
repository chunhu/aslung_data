// Public filenames use Taiwan calendar dates; UUIDs remain internal identifiers.
/**
 * @param {string} device
 * @param {string} start
 * @param {string} end
 * @param {{endExclusive?:boolean,segmentId?:string|number}} [options]
 */
export function exportName(device,start,end,{endExclusive=false,segmentId}={}){
  const lower=Date.parse(start),upper=Date.parse(end);
  if(!Number.isFinite(lower)||!Number.isFinite(upper)||upper<lower)throw new Error('匯出檔名日期不正確。');
  const day=time=>new Date(time+8*3600000).toISOString().slice(0,10).replaceAll('-','');
  const first=day(lower),last=day(endExclusive&&upper>lower?upper-1:upper);
  const safe=value=>String(value).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80);
  return `${safe(device)}_${first}${first===last?'':'_'+last}${segmentId?'_segment-'+safe(segmentId):''}`;
}
