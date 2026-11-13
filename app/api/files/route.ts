import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {limitedBody,limitedJson,safeFileHeaders,HttpSecurityError} from '@/lib/http-security.mjs';
import {auditOperation,setActivityAction} from '@/lib/activity-server';
import {identity,writeGuard,fail,AppError} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {createFileLink,externalFileUrl,FileLinkError} from '@/lib/file-links.mjs';
import {fileContext,requireFileRight,fileWorkspace,filePermissionList,fileManagementAction,replaceLegacyFileGrants,deleteManagedFile,withFileWrite,addLegacyFileGrants,previewableFile,FileAccessError} from '@/lib/file-access.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
function failure(error:unknown){
  if(error instanceof FileAccessError||error instanceof FileLinkError||error instanceof HttpSecurityError)return fail(new AppError(error.status,error.message));
  if(error instanceof Error&&error.message.includes('UNIQUE constraint'))return fail(new AppError(409,'名稱已存在，請使用其他名稱。'));
  return fail(error);
}
async function handleGET(request:Request){try{
  const me=await identity(request),d=getConnection(),params=new URL(request.url).searchParams,id=params.get('id');
  if(!id){
    if(params.get('action')==='permissions')return Response.json(filePermissionList(d,me,params.get('resource_type'),params.get('resource_id')),{headers});
    return Response.json(fileWorkspace(d,me,{folder:params.get('folder')||'root',q:params.get('q')||'',page:Number(params.get('page')||1)}),{headers});
  }
  const ctx=fileContext(d,me),file=ctx.files.get(id);if(!file)throw new AppError(404,'找不到此檔案。');
  const download=params.get('download')==='1';requireFileRight(ctx,'file',id,download?'download':'view');
  // A view-only user must never receive an attachment or an external original URL.
  if(!download&&!previewableFile(file))throw new AppError(403,'此檔案不支援安全預覽；下載原檔或開啟外部連結需具下載權限。');
  if(file.external_url){
    const url=externalFileUrl(file.external_url);d.prepare('UPDATE files SET download_count=download_count+1 WHERE id=?').run(id);
    return new Response(null,{status:303,headers:{...headers,Location:url,'Referrer-Policy':'no-referrer'}});
  }
  if(!fs.existsSync(file.storage_path))throw new AppError(404,'檔案實體不存在。');
  const size=fs.statSync(file.storage_path).size;
  if(download)d.prepare('UPDATE files SET download_count=download_count+1 WHERE id=?').run(id);
  return new Response(Readable.toWeb(fs.createReadStream(file.storage_path)) as ReadableStream,{headers:{...safeFileHeaders(file,download),'Content-Length':String(size)}});
}catch(error){return failure(error);}}
async function handlePOST(request:Request){try{
  writeGuard(request);const me=await identity(request),d=getConnection();
  if((request.headers.get('content-type')||'').includes('multipart/form-data')){
    const folder=new URL(request.url).searchParams.get('folder')||'root';requireFileRight(fileContext(d,me),'folder',folder,'manage');
    const body=await limitedBody(request,11*1024*1024),form=await new Request(request.url,{method:'POST',headers:request.headers,body:body as BodyInit}).formData();
    const file=form.get('file'),description=String(form.get('description')||'').trim();
    if(!(file instanceof File)||!file.name||file.name.length>255||/[\u0000-\u001f\u007f]/.test(file.name))throw new AppError(400,'請選擇有效檔案。');
    if(file.size>10*1024*1024)throw new AppError(413,'檔案上限 10 MB。');if(description.length>2000)throw new AppError(400,'說明最多 2000 字。');
    let emails:any=[];try{emails=JSON.parse(String(form.get('emails')||'[]'));}catch{throw new AppError(400,'授權會員名單格式不正確。');}
    if(!Array.isArray(emails)||emails.length>1000||emails.some(email=>typeof email!=='string'))throw new AppError(400,'授權會員名單格式不正確。');
    const id='f_'+randomUUID().replaceAll('-','').slice(0,16),directory=path.resolve('./data/uploads'),target=path.join(directory,id+path.extname(file.name));
    const bytes=Buffer.from(await file.arrayBuffer());let written=false;
    setActivityAction(request,'file.upload',id);
    try{return Response.json(withFileWrite(d,me,folder,()=>{
      fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.writeFileSync(target,bytes,{mode:0o600,flag:'wx'});written=true;
      d.prepare('INSERT INTO files(id,name,size,mime_type,description,uploader_email,storage_path,created_at,folder_id) VALUES(?,?,?,?,?,?,?,?,?)').run(id,file.name,file.size,file.type||'application/octet-stream',description,me.email,target,new Date().toISOString(),folder);
      if(emails.length)addLegacyFileGrants(d,id,emails,me);return {ok:true,fileId:id};
    }),{headers});}catch(error){if(written)try{fs.unlinkSync(target);}catch{}throw error;}
  }
  const input=await limitedJson(request,512*1024);if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError(400,'管理內容格式不正確。');
  setActivityAction(request,input.action,input.resource_id||input.id||input.folder_id||'');
  if(input.action==='fileLink')return Response.json(createFileLink(d,me,input),{headers});
  if(input.action==='fileDelete')return Response.json(deleteManagedFile(d,me,String(input.id||'')),{headers});
  if(input.action==='fileGrantsUpdate')return Response.json(replaceLegacyFileGrants(d,me,String(input.id||input.fileId||''),input.emails),{headers});
  return Response.json(fileManagementAction(d,me,input),{headers});
}catch(error){return failure(error);}}
export async function POST(request:Request){return auditOperation(request,()=>handlePOST(request));}
export async function GET(request:Request){return new URL(request.url).searchParams.has('id')?auditOperation(request,()=>handleGET(request),'download'):handleGET(request);}
