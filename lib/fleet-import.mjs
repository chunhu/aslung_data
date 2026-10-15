export const IMPORT_FIELDS = [
  {key:'lab_id',label:'地點編號',required:true}, {key:'device_id',label:'設備編號',required:true},
  {key:'device_type',label:'設備類型'}, {key:'maintainer',label:'負責人'},
  {key:'start_date',label:'開始日期',required:true}, {key:'end_date',label:'結束日期'}, {key:'active',label:'使用中'}
];
const aliases={lab_id:['lab_id','地點編號','lab id'],device_id:['device_id','aslung_id','設備編號','aslung id'],
  device_type:['device_type','設備類型'],maintainer:['maintainer','負責人','維護者'],start_date:['start_date','開始日期','開始時間'],
  end_date:['end_date','結束日期','結束時間'],active:['active','使用中']};

export function parseImportTable(text) {
  text=text.replace(/^\uFEFF/,'');
  const firstLine=text.split(/\r?\n/)[0]||'';
  const delimiter=firstLine.includes('\t')?'\t':',';
  const rows=[],rowNumbers=[];let row=[],cell='',quoted=false,rowNumber=1;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;
    }else if(!quoted&&(c===delimiter||c==='\n'||c==='\r')){
      row.push(cell.trim());cell='';
      if(c!==delimiter){if(row.some(Boolean)){rows.push(row);rowNumbers.push(rowNumber);}rowNumber++;row=[];if(c==='\r'&&text[i+1]==='\n')i++;}
    }else cell+=c;
  }
  if(quoted)throw new Error('CSV 引號未關閉，請檢查檔案格式。');
  row.push(cell.trim());if(row.some(Boolean)){rows.push(row);rowNumbers.push(rowNumber);}
  const headers=rows.shift()||[];
  rowNumbers.shift();
  const normalized=headers.map(h=>h.toLowerCase().trim());
  const mapping=Object.fromEntries(IMPORT_FIELDS.map(f=>[f.key,normalized.findIndex(h=>aliases[f.key].includes(h))]));
  return {headers,rows,mapping,rowNumbers};
}

export function importDate(value, end = false) {
  if(!value)return null;
  const s=String(value).trim(),m=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if(m){
    const [,y,month,day]=m,mo=month.padStart(2,'0'),d=day.padStart(2,'0');
    const check=new Date(`${y}-${mo}-${d}T00:00:00Z`);
    if(!Number.isFinite(check.getTime())||check.toISOString().slice(0,10)!==`${y}-${mo}-${d}`)return null;
    return new Date(`${y}-${mo}-${d}T${end?'23:59:59':'00:00:00'}+08:00`).toISOString();
  }
  if(!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(s))return null;
  if(!importDate(s.slice(0,10)))return null;
  const date=new Date(s);return Number.isFinite(date.getTime())?date.toISOString():null;
}

export function analyzeImport(text, mapping, onlyAslung = true) {
  const table=parseImportTable(text), map=mapping||table.mapping, records=[],issues=[];
  for(const field of IMPORT_FIELDS){
    const index=map[field.key];
    if(!Number.isInteger(index)||index < -1||index>=table.headers.length)throw new Error(`${field.label}欄位對應不正確。`);
    if((field.required||(field.key==='device_type'&&onlyAslung))&&index===-1)throw new Error(`請對應「${field.label}」欄位。`);
  }
  const chosen=Object.values(map).filter(i=>i>=0);
  if(new Set(chosen).size!==chosen.length)throw new Error('同一來源欄位不能對應到兩個欄位。');
  if(table.rows.length>5000)throw new Error('單次最多匯入 5,000 筆，請分批處理。');
  const keys=new Set();let skipped=0;
  table.rows.forEach((cols,i)=>{
    const row=table.rowNumbers[i],get=key=>String(cols[map[key]]||'').trim();
    const lab=get('lab_id'),id=get('device_id'),type=get('device_type'),start=get('start_date'),end=get('end_date'),flag=get('active').toUpperCase();
    const error=message=>issues.push({row,level:'error',message});
    if(type&&type.toLowerCase()!=='aslung'&&id.toLowerCase()==='aslung'){
      error('設備類型與設備編號可能對調；請重新對應這兩個欄位。');return;
    }
    if(onlyAslung&&type.toLowerCase()!=='aslung'){skipped++;return;}
    if(!lab||!id||!start){error('地點編號、設備編號與開始日期皆為必填。');return;}
    if(lab.length>160||id.length>80||!/^[A-Za-z0-9_-]+$/.test(id)){error('設備編號格式或地點編號長度不正確。');return;}
    const startTime=importDate(start),endTime=importDate(end,true);
    if(!startTime||(end&&!endTime)){error('日期無效；請使用 YYYY-MM-DD，或包含時區的 ISO 日期時間。');return;}
    if(endTime&&endTime<startTime){error('結束日期不能早於開始日期。');return;}
    if(flag&&!['Y','N','TRUE','FALSE','1','0'].includes(flag)){error('使用中欄位請填 Y / N、TRUE / FALSE 或 1 / 0。');return;}
    const active=flag?['Y','TRUE','1'].includes(flag):!endTime;
    if(active&&endTime){error('使用中紀錄不能同時填寫結束日期。');return;}
    const key=JSON.stringify([lab,id,startTime]);
    if(keys.has(key)){error('同一地點、設備與開始時間有重複紀錄。');return;}keys.add(key);
    const maintainer=get('maintainer');
    if(maintainer.length>80){error('負責人姓名最多 80 個字。');return;}
    if(active&&!maintainer)issues.push({row,level:'warning',message:'未指派負責人，將無法依負責人發送告警。'});
    records.push({row,lab_id:lab,aslung_id:id,maintainer,start_time:startTime,end_time:endTime,active:active?1:0});
  });
  return {headers:table.headers,mapping:map,records,issues,skipped,total:table.rows.length};
}
