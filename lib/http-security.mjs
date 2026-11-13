export {clientIp} from './activity.mjs';
export class HttpSecurityError extends Error{constructor(status,message){super(message);this.status=status;}}
export async function limitedBody(request,maximum){
  const declared=Number(request.headers.get('content-length')||0);
  if(declared>maximum)throw new HttpSecurityError(413,'內容超過允許大小。');
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  let length=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maximum){await reader.cancel();throw new HttpSecurityError(413,'內容超過允許大小。');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}return body;
}
export async function limitedJson(request,maximum){
  try{return JSON.parse(new TextDecoder().decode(await limitedBody(request,maximum)));}
  catch(e){if(e instanceof HttpSecurityError)throw e;throw new HttpSecurityError(400,'JSON 內容格式不正確。');}
}
export function safeFileHeaders(file,download=false){
  const mime=String(file.mime_type||'').toLowerCase().split(';')[0].trim();
  const safe=['application/pdf','image/png','image/jpeg','image/gif','image/webp','text/plain','text/csv'].includes(mime);
  return {'Content-Type':safe?mime:'application/octet-stream','X-Content-Type-Options':'nosniff',
    'Content-Disposition':`${download||!safe?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'self'",'Referrer-Policy':'no-referrer','Cache-Control':'private, no-store'};
}
export function googleCsvUrl(value){
  let url;try{url=new URL(value);}catch{throw new HttpSecurityError(400,'請提供 Google 試算表網址。');}
  const match=url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{1,200})(?:\/|$)/);
  if(url.protocol!=='https:'||url.hostname!=='docs.google.com'||url.port||url.username||url.password||!match)throw new HttpSecurityError(400,'同步僅接受 https://docs.google.com 的 Google 試算表網址。');
  const gid=url.searchParams.get('gid')||new URLSearchParams(url.hash.slice(1)).get('gid')||'0';
  if(!/^\d{1,20}$/.test(gid))throw new HttpSecurityError(400,'Google 試算表分頁識別碼不正確。');
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
}
export async function fetchGoogleCsv(value,fetcher=fetch){
  let url=googleCsvUrl(value);const signal=AbortSignal.timeout(30000);
  for(let redirects=0;redirects<=3;redirects++){
    const result=await fetcher(url,{redirect:'manual',signal,cache:'no-store'});
    if([301,302,303,307,308].includes(result.status)){
      const location=result.headers.get('location');await result.body?.cancel();
      let next;try{next=new URL(location,url);}catch{throw new HttpSecurityError(502,'Google 下載重新導向不正確。');}
      if(!location||next.protocol!=='https:'||next.port||next.username||next.password||!(next.hostname==='docs.google.com'||next.hostname.endsWith('.googleusercontent.com')))throw new HttpSecurityError(502,'Google 下載重新導向至未允許的來源。');
      url=next.href;continue;
    }
    if(!result.ok){await result.body?.cancel();throw new HttpSecurityError(502,'無法下載 Google 試算表，請確認分享權限。');}
    return new TextDecoder().decode(await limitedBody(result,12*1024*1024));
  }
  throw new HttpSecurityError(502,'Google 下載重新導向過多。');
}
