import fs from 'node:fs/promises';
import {getConnection} from '@/lib/store.mjs';
import {identity,writeGuard,fail,AppError} from '@/lib/server';
import {registrationMailer} from '@/lib/registration-mail';
import {RegistrationError} from '@/lib/registration.mjs';
import {limitedJson,safeFileHeaders,HttpSecurityError} from '@/lib/http-security.mjs';
import {clientIp} from '@/lib/activity.mjs';
import {externalFileUrl} from '@/lib/file-links.mjs';
import {setActivityAction,auditOperation} from '@/lib/activity-server';
import {GuestFileError,publicGuestFiles,guestRate,setGuestPublication,beginGuestRequest,verifyGuestRequest,createGuestShare,reviewGuestRequest,disableGuestShare,reissueGuestShare,markGuestMail,beginGuestDownload,verifyGuestDownload,guestDownloadFile,reserveGuestDownload,finishGuestDownload,guestAdminOverview,exportGuestDownloads} from '@/lib/guest-files.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
function failure(e:unknown){if(e instanceof GuestFileError||e instanceof HttpSecurityError||e instanceof RegistrationError)return fail(new AppError(e.status,e.message));return fail(e);}
export async function GET(r:Request){try{
 const d=getConnection(),p=Object.fromEntries(new URL(r.url).searchParams);
 if(!p.action)return Response.json(publicGuestFiles(d,p),{headers});
 const me=await identity(r);
 if(p.action==='admin')return Response.json(guestAdminOverview(d,me,p),{headers});
 if(p.action==='export')return new Response(exportGuestDownloads(d,me,p),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="guest-downloads.csv"'}});
 throw new AppError(400,'無效操作。');
 }catch(e){return failure(e);}}
async function handlePOST(r:Request){try{
 writeGuard(r);const p=await limitedJson(r,16000);if(!p||typeof p!=='object'||Array.isArray(p))throw new AppError(400,'操作格式不正確。');
 const d=getConnection(),ip=clientIp(r);setActivityAction(r,'guestFiles.'+String(p.action),p.file_id||p.id||'');
 if(['publication','create','review','disable','resend'].includes(p.action)){
   const me=await identity(r);if(me.role!=='admin')throw new AppError(403,'只有管理員可以管理訪客分享。');
   if(p.action==='publication')return Response.json(setGuestPublication(d,me,p),{headers});
   if(p.action==='disable')return Response.json(disableGuestShare(d,me,p),{headers});
   if(p.action==='review'&&p.decision==='reject')return Response.json(reviewGuestRequest(d,me,p),{headers});
   // Check SMTP configuration before persisting an approval. Delivery failures remain retryable.
   const mailer=registrationMailer();
   const result=p.action==='create'?createGuestShare(d,me,p):p.action==='resend'?reissueGuestShare(d,me,p):reviewGuestRequest(d,me,p);
   if('token' in result){try{await mailer.guestShare(result);markGuestMail(d,result.id,true);return Response.json({ok:true,id:result.id,mail_status:'sent'},{headers});}
     catch{markGuestMail(d,result.id,false);return Response.json({ok:true,id:result.id,mail_status:'failed',notice:'設定已儲存，但寄信失敗，請檢查 SMTP 並按重新寄送。'},{headers});}}
   return Response.json(result,{headers});
 }
 guestRate(d,'site',1000);guestRate(d,'ip:'+ip,ip?120:500);
 if(p.action==='request'){
   guestRate(d,'request-site',100);guestRate(d,'request-ip:'+ip,ip?10:50);
   const mailer=registrationMailer(),result=beginGuestRequest(d,p);
   try{await mailer.guestCode(result.email,result.code);}catch{d.prepare('DELETE FROM guest_file_codes WHERE context=?').run('request:'+result.id);throw new AppError(503,'驗證信寄送失敗，請稍後重新申請。');}
   return Response.json({ok:true,id:result.id},{headers});
 }
 if(p.action==='verifyRequest')return Response.json(verifyGuestRequest(d,p),{headers});
 if(p.action==='code'){
   guestRate(d,'code-site',100);const mailer=registrationMailer(),result=beginGuestDownload(d,p.token);
   try{await mailer.guestCode(result.email,result.code);}catch{throw new AppError(503,'驗證信寄送失敗，請稍後再試。');}
   return Response.json({ok:true,masked_email:result.masked_email},{headers});
 }
 if(p.action==='verifyDownload')return Response.json(verifyGuestDownload(d,p),{headers});
 if(p.action==='download'){
   const {file:f}=guestDownloadFile(d,p.session);
   if(f.external_url){const url=externalFileUrl(f.external_url),attempt=reserveGuestDownload(d,p.session,{ip,userAgent:r.headers.get('user-agent')||''});finishGuestDownload(d,attempt.id,'redirected');return Response.json({external_url:url},{headers});}
   let handle;try{handle=await fs.open(f.storage_path,'r');}catch{throw new AppError(404,'檔案實體不存在。');}
   try{
     const stat=await handle.stat();if(!stat.isFile())throw new AppError(404,'檔案實體不存在。');
     const attempt=reserveGuestDownload(d,p.session,{ip,userAgent:r.headers.get('user-agent')||''});
     const source=handle.readableWebStream(),reader=source.getReader();let bytes=0,finished=false;
     const finish=async(status:string)=>{if(finished)return;finished=true;try{finishGuestDownload(d,attempt.id,status,bytes);}finally{await handle.close().catch(()=>{});}};
     const body=new ReadableStream({async pull(controller){try{const next=await reader.read();if(next.done){await finish('completed');controller.close();}else{bytes+=next.value.byteLength;controller.enqueue(next.value);}}catch{await finish('failed');controller.error(new Error('File transfer failed'));}},async cancel(){try{await reader.cancel();}finally{await finish('interrupted');}}});
     return new Response(body,{headers:{...headers,...safeFileHeaders(f,true),'Content-Length':String(stat.size)}});
   }catch(e){await handle.close().catch(()=>{});throw e;}
 }
 throw new AppError(400,'無效操作。');
 }catch(e){return failure(e);}}
export async function POST(r:Request){return auditOperation(r,()=>handlePOST(r),'download');}
