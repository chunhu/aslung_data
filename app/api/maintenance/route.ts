import {identity,writeGuard,fail,AppError} from '@/lib/server';
import {getConnection} from '@/lib/store.mjs';
import {listMaintenance,saveMaintenance,addMaintenanceAttachment,getMaintenanceAttachment,MaintenanceError} from '@/lib/maintenance.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
function failure(e:unknown){return e instanceof MaintenanceError?Response.json({error:e.message},{status:e.status,headers}):fail(e);}
export async function GET(req:Request){
  try{
    const me=await identity(req),params=new URL(req.url).searchParams,d=getConnection();
    const attachment=params.get('attachment');
    if(attachment){
      const file=getMaintenanceAttachment(d,me,attachment);
      return new Response(new Uint8Array(file.data),{headers:{...headers,'Content-Type':file.mime,'Content-Length':String(file.size),
        'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,'X-Content-Type-Options':'nosniff'}});
    }
    const result=listMaintenance(d,me,params.get('id'));
    if(params.get('capability')==='1')return Response.json({canUse:result.canUse},{headers});
    return Response.json(result,{headers});
  }catch(e){return failure(e);}
}
export async function POST(req:Request){
  try{
    writeGuard(req);const me=await identity(req),d=getConnection();
    if((req.headers.get('content-type')||'').includes('multipart/form-data')){
      if(Number(req.headers.get('content-length')||0)>6*1024*1024)throw new AppError(413,'附件上限 5 MB。');
      const form=await req.formData(),file=form.get('file'),id=String(form.get('id')||'');
      if(!(file instanceof File)||file.size>5*1024*1024)throw new AppError(400,'請選擇不超過 5 MB 的附件。');
      listMaintenance(d,me,id);
      return Response.json({ok:true,...addMaintenanceAttachment(d,me,id,file,Buffer.from(await file.arrayBuffer()))},{headers});
    }
    if(Number(req.headers.get('content-length')||0)>32000)throw new AppError(413,'內容過長。');
    const result=saveMaintenance(d,me,await req.json());
    return Response.json({ok:true,...result},{headers});
  }catch(e){return failure(e);}
}
