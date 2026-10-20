import {randomUUID} from 'node:crypto';
import {ensureProcessingSchema,readProcessingResult,processingRoot} from './processing-jobs.mjs';
import {processingResultFile} from './processing-storage.mjs';
import {csvChunks,jsonChunks,csvZipResponse,jsonZipResponse} from './csv-zip.mjs';
const error=(status,message)=>Object.assign(new Error(message),{status});
const iso=n=>new Date(n).toISOString();
const noStore={'Cache-Control':'no-store'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function selectProcessedPieces(jobs,ranges){
  const pieces=[],missing=[];
  const ordered=jobs.map(j=>({...j,lower:Date.parse(j.start),upper:Date.parse(j.end)}))
    .sort((a,b)=>String(b.finished_at||'').localeCompare(String(a.finished_at||''))||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
  for(const range of ranges){
    // The existing measurement API includes both endpoints; files use [start,end).
    const lower=Date.parse(range.start),upper=Date.parse(range.end)+1;
    const cuts=[...new Set([lower,upper,...ordered.flatMap(j=>[j.lower,j.upper]).filter(n=>n>lower&&n<upper)])].sort((a,b)=>a-b);
    for(let i=0;i<cuts.length-1;i++){
      const start=cuts[i],end=cuts[i+1];
      const candidate=ordered.find(j=>j.lower<=start&&j.upper>=end);
      const previous=pieces.at(-1);
      if(!candidate){const last=missing.at(-1);if(last&&last.end===iso(start))last.end=iso(end);else missing.push({start:iso(start),end:iso(end)});continue;}
      const id=candidate.id;
      if(previous&&previous.id===id&&previous.end===iso(start))previous.end=iso(end);
      else pieces.push({id,start:iso(start),end:iso(end)});
    }
  }
  if(missing.length){
    const descriptions=missing.slice(0,8).map(r=>`${r.start} ～ ${iso(Date.parse(r.end)-1)}`).join('；');
    throw error(409,'所選區間尚無完整的清理與校正結果：'+descriptions+(missing.length>8?`；另有 ${missing.length-8} 個區間`:'')+'。請等待背景工作完成，或由管理員建立區間校正工作。日期顯示為 UTC；不會以原始值補齊。');
  }
  return pieces;
}
function ensureSnapshots(d){
  ensureProcessingSchema(d);
  d.exec(`CREATE TABLE IF NOT EXISTS processing_query_snapshots(id TEXT PRIMARY KEY,device TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,ranges TEXT NOT NULL,pieces TEXT NOT NULL,created_at TEXT NOT NULL)`);
}
export async function preparedProcessedQuery(d,{id,start,end,ranges,snapshot,authorize,root=processingRoot()}){
  ensureSnapshots(d);let pieces,token=snapshot;
  if(snapshot){
    if(!snapshot.startsWith('processed:')||!uuid.test(snapshot.slice(10)))throw error(400,'已校正結果版本格式不正確。');
    const pinned=d.prepare('SELECT * FROM processing_query_snapshots WHERE id=?').get(snapshot.slice(10));
    if(!pinned||pinned.device!==id||pinned.start!==start||pinned.end!==end||pinned.ranges!==JSON.stringify(ranges))throw error(409,'已校正查詢版本與設備或授權區間不符，請重新查詢。');
    pieces=JSON.parse(pinned.pieces);
  }else{
    const jobs=d.prepare(`SELECT id,start,end,finished_at,created_at FROM processing_jobs WHERE device=? AND status='COMPLETED' AND start<=? AND end>? ORDER BY finished_at DESC,created_at DESC LIMIT 5001`).all(id,end,start);
    if(jobs.length>5000)throw error(413,'區間內校正版本過多，請縮短日期範圍。');
    pieces=selectProcessedPieces(jobs,ranges);
  }
  const jobs=new Map();
  for(const jobId of new Set(pieces.map(p=>p.id))){
    const job=d.prepare('SELECT id,device,start,end,context_start,context_end,recipe,status,finished_at,result_bucket,result_region,result_key,result_sha256,result_bytes FROM processing_jobs WHERE id=?').get(jobId);
    if(!job||job.device!==id||job.status!=='COMPLETED')throw error(409,'指定的已校正結果無法使用，請重新查詢。');
    await authorize(job);
    await processingResultFile(job,root);
    jobs.set(jobId,job);
  }
  if(!token){
    const key=randomUUID();d.prepare('INSERT INTO processing_query_snapshots VALUES(?,?,?,?,?,?,?)').run(key,id,start,end,JSON.stringify(ranges),JSON.stringify(pieces),new Date().toISOString());token='processed:'+key;
  }
  async function* rows(){for(const piece of pieces){
    const job=jobs.get(piece.id),recipe=JSON.parse(job.recipe);
    for await(const row of readProcessingResult(job,root))if(row.timestamp>=piece.start&&row.timestamp<piece.end)
      yield {...row,_processing_job_id:job.id,_processing_up_limit:recipe.upLimit};
  }}
  return {snapshot:token,rows,jobs:[...jobs.values()].map(j=>({id:j.id,start:j.start,end:j.end,recipe:JSON.parse(j.recipe),finished_at:j.finished_at}))};
}
export async function processedDataResponse(d,{url,id,start,end,ranges,segmentId,authorize,root=processingRoot()}){
  const cursor=url.searchParams.get('cursor')||'',requestedSnapshot=url.searchParams.get('calibration_snapshot');
  if(cursor&&!requestedSnapshot)throw error(400,'已校正分頁必須帶回查詢版本。');
  const query=await preparedProcessedQuery(d,{id,start,end,ranges,snapshot:requestedSnapshot,authorize,root});
  const metadata={aslung_id:id,start,end,segment_id:segmentId,authorized_ranges:ranges,calibration:'processed',calibration_snapshot:query.snapshot,processing_jobs:query.jobs};
  if(url.searchParams.get('download')==='1'){
    const format=url.searchParams.get('format')||'json';if(!['csv','json','csvzip','jsonzip'].includes(format))throw error(400,'下載僅支援 CSV ZIP 或 JSON ZIP。');
    if(format==='csv'||format==='csvzip')return csvZipResponse(csvChunks(query.rows()),`processed_${id}`);
    return jsonZipResponse(jsonChunks(query.rows(),metadata),`processed_${id}`);
  }
  let offset=0;
  if(cursor){
    try{const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(value.snapshot!==query.snapshot||!Number.isSafeInteger(value.offset)||value.offset<0)throw new Error();offset=value.offset;}
    catch{throw error(400,'已校正分頁格式不正確。');}
  }
  const data=[];let seen=0,has_more=false;
  for await(const row of query.rows()){
    if(seen++<offset)continue;
    if(data.length===1000){has_more=true;break;}data.push(row);
  }
  return Response.json({...metadata,data,has_more,next_cursor:has_more?Buffer.from(JSON.stringify({offset:offset+data.length,snapshot:query.snapshot})).toString('base64url'):null},{headers:noStore});
}
