import {getConnection} from './store.mjs';
import {recordActivity,pruneActivity,clientIp,limitActivity} from './activity.mjs';
import {identity,AppError} from './server';
const details=new WeakMap<Request,{event:string;target:string}>();
export function checkLoginRate(request:Request){
  try{const d=getConnection();limitActivity(d,'login:site',120);limitActivity(d,'login:ip:'+clientIp(request),30);d.prepare('DELETE FROM login_attempts WHERE email IN (SELECT email FROM login_attempts WHERE window_start<? LIMIT 1000)').run(Date.now()-900000);}
  catch{throw new AppError(429,'登入要求過於頻繁，請稍後再試。');}
}
export function setActivityAction(request:Request,action:unknown,target:unknown=''){
  const event=typeof action==='string'&&/^[A-Za-z][A-Za-z0-9.]{0,79}$/.test(action)?action:request.method;
  const value=typeof target==='string'||typeof target==='number'?String(target).slice(0,160):'';
  details.set(request,{event,target:/token|password|smtp|secret/i.test(event)||/^aslung_|^[a-f0-9]{64}$/i.test(value)?'':value});
}
export function recordRequestEvent(request:Request,event:{kind:string;event:string;actor?:string;target?:string;outcome?:string}){
  try{
    const d=getConnection(),ip=clientIp(request);
    limitActivity(d,'audit:site',2000);limitActivity(d,'audit:ip:'+ip,120);
    recordActivity(d,{...event,ip,userAgent:request.headers.get('user-agent')||''});pruneActivity(d);
  }catch{/* Logging failure must not expose secrets or replace a business response. */}
}
export async function auditOperation(request:Request,handler:()=>Promise<Response>,kind='operation'){
  let actor='';
  if(request.method==='GET'||request.headers.get('origin')===process.env.APP_ORIGIN){try{actor=(await identity(request)).email;}catch{}}
  const response=await handler();
  const info=details.get(request),url=new URL(request.url);
  const candidate=info?info.target:(url.pathname==='/api/files'?url.searchParams.get('id'):url.searchParams.get('aslung_id')||url.searchParams.get('serial'))||'';
  const target=/^aslung_|^[a-f0-9]{64}$/i.test(candidate)?'':candidate;
  recordRequestEvent(request,{kind,event:url.pathname+':'+(info?.event||request.method),actor,target,outcome:response.ok||response.status===303?'success':'failure'});
  return response;
}
