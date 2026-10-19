// Versioned scientific rules. Raw rows are never mutated.
export const PROCESSING_VERSION='six-rules-1';
export const HALO=25;
export const DEFAULT_UP_LIMIT=3;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function processingRecipe(upLimit=DEFAULT_UP_LIMIT){
  if(typeof upLimit!=='number'||!Number.isFinite(upLimit)||upLimit<0)throw new Error('up_limit 必須填寫大於或等於 0 的有限數值。');
  return {version:PROCESSING_VERSION,upLimit,ghostRatio:10,ghostWindow:5,ghostPasses:5};
}
function ghost(values,reverse=false){
  const input=reverse?[...values].reverse():[...values];let output=[...input];
  for(let pass=0;pass<5;pass++){
    const previous=output;
    output=input.map((value,i)=>{
      const neighbors=previous.slice(Math.max(0,i-5),i).filter(finite);
      const mean=neighbors.length?neighbors.reduce((a,b)=>a+b,0)/neighbors.length:NaN;
      return finite(value)&&value/mean<10?value:null;
    });
  }
  return reverse?output.reverse():output;
}
export function processMeasurements(rows,factors,recipe){
  processingRecipe(recipe.upLimit);
  if(recipe.version!==PROCESSING_VERSION)throw new Error('不支援此清理規則版本，請使用對應版本的 worker。');
  const groups=new Map();
  for(const factor of factors){const key=factor.aslung_id+'|'+factor.channel;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(factor);}
  const indexes=new Map();
  for(const [key,records] of groups){
    records.sort((a,b)=>a.start.localeCompare(b.start));let maxEnd=-Infinity;
    indexes.set(key,records.map(r=>{maxEnd=Math.max(maxEnd,r.end?Date.parse(r.end):Infinity);return {rule:r,start:Date.parse(r.start),end:r.end?Date.parse(r.end):Infinity,maxEnd};}));
  }
  const matching=(key,time)=>{
    const records=indexes.get(key)||[];let low=0,high=records.length;
    while(low<high){const middle=(low+high)>>>1;if(records[middle].start<=time)low=middle+1;else high=middle;}
    const found=[];for(let i=low-1;i>=0&&records[i].maxEnd>time;i--)if(records[i].end>time)found.push(records[i].rule);
    return found;
  };
  const result=rows.map(row=>({...row,_processing_version:recipe.version,_quality:{}}));
  const flag=(i,channel,reason)=>{const q=result[i]._quality;(q[channel]??=[]).push(reason);};
  // Each call contains exactly one device, ordered by timestamp and raw row ID.
  if(new Set(rows.map(r=>r.aslung_id)).size>1)throw new Error('每個計算區塊只可包含同一台設備。');
  for(const sensor of ['G3','GSA']){
    const channels=['PM1','PM2.5','PM10'].map(c=>c+'_'+sensor);
    const base=rows.map((row,i)=>{
      const raw=channels.map(c=>row[c]),equal=raw.every(finite)&&raw[0]>50&&raw.every(v=>v===raw[0]);
      return raw.map((value,j)=>{
        if(!finite(value)){flag(i,channels[j],'INVALID_RAW');return null;}
        if(equal){flag(i,channels[j],'PM_EQUAL_HIGH');return null;}
        if(value<1){flag(i,channels[j],'PM_BELOW_ONE');return null;}
        return value;
      });
    });
    const pm25=base.map(v=>v[1]),forward=ghost(pm25),backward=ghost(pm25,true);
    rows.forEach((row,i)=>{
      const keep=finite(forward[i])||finite(backward[i]);
      channels.forEach((channel,j)=>{
        const clean=keep?base[i][j]:null;
        if(!keep&&finite(base[i][j]))flag(i,channel,'GHOST_PEAK');
        result[i][channel+'_clean']=clean;
        const timestamp=Date.parse(row.timestamp);
        const matches=matching(row.aslung_id+'|'+channel,timestamp);
        const factor=matches.length===1?matches[0]:null;
        let value=null;
        if(!finite(clean))flag(i,channel,'CLEAN_MISSING');
        else if(!factor)flag(i,channel,matches.length?'FACTOR_CONFLICT':'NO_FACTOR');
        else{
          const second=factor.a2!==null&&factor.a2!==undefined&&clean>=factor.breakpoint;
          value=(second?factor.a2:factor.a1)*clean+(second?factor.b2:factor.b1);
          if(!finite(value)){value=null;flag(i,channel,'INVALID_CALIBRATED');}
          else if(value<0){value=null;flag(i,channel,'NEGATIVE_CALIBRATED');}
        }
        result[i][channel+'_calibrated']=value;
        result[i][channel+'_final']=value;
        result[i][channel+'_calibration_version']=factor?.version_id??null;
        result[i][channel+'_calibration_record']=factor?.id??null;
      });
      const [p1,p25]=channels;
      if(finite(result[i][p1+'_final'])&&finite(result[i][p25+'_final'])&&result[i][p1+'_final']>result[i][p25+'_final']){
        result[i][p1+'_final']=result[i][p25+'_final'];flag(i,p1,'PM1_CAPPED_TO_PM25');
      }
      const raw=channels.map(c=>row[c]);
      if(raw.every(finite)){
        if(raw[0]>50&&Math.abs(raw[0]-raw.reduce((a,b)=>a+b,0)/3)<=recipe.upLimit){
          for(const channel of channels){result[i][channel+'_final']=null;flag(i,channel,'PM_NEAR_EQUAL_HIGH');}
        }
      }else for(const channel of channels)flag(i,channel,'NEAR_EQUAL_NOT_EVALUABLE');
    });
  }
  rows.forEach((row,i)=>{
    for(const channel of ['temperature','rh','co2']){
      const value=row[channel];result[i][channel+'_clean']=finite(value)&&value>=1?value:null;
      if(!finite(value))flag(i,channel,'INVALID_RAW');else if(value<1)flag(i,channel,'BELOW_ONE');
    }
  });
  return result;
}
