import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {limitedBody,HttpSecurityError} from '@/lib/http-security.mjs';
import {getConnection} from '@/lib/store.mjs';
import {ensurePostSchema} from '@/lib/posts.mjs';
import {auditOperation,setActivityAction} from '@/lib/activity-server';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie, Authorization, X-API-Key','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function GET(req:Request){try{
  const id=new URL(req.url).searchParams.get('id');
  if(!id||!/^[a-f0-9-]{36}$/.test(id))throw new AppError(404,'找不到圖片。');
  const d=getConnection();ensurePostSchema(d);
  const publicImage=!!d.prepare("SELECT 1 FROM site_post_image_refs r JOIN site_posts p ON p.id=r.post_id WHERE r.image_id=? AND p.status='published' AND p.visibility='public' LIMIT 1").get(id);
  const me=publicImage?null:await identity(req);
  if(!publicImage&&me?.role!=='admin'&&!d.prepare("SELECT 1 FROM site_post_image_refs r JOIN site_posts p ON p.id=r.post_id WHERE r.image_id=? AND p.status='published' LIMIT 1").get(id))throw new AppError(404,'圖片不存在或所屬文章尚未發布。');
  const row=d.prepare('SELECT data,mime_type FROM site_post_images WHERE id=?').get(id) as any;if(!row)throw new AppError(404,'找不到圖片。');
  return new Response(new Uint8Array(row.data),{headers:{...headers,'Content-Type':row.mime_type,'Content-Disposition':'inline; filename="post-image.webp"'}});
}catch(e){return fail(e);}}
const pool=(globalThis as any)[Symbol.for('aslung.post-image.pool')]??=((globalThis as any)[Symbol.for('aslung.post-image.pool')]={active:0});
async function upload(req:Request){let reserved=false;try{
  writeGuard(req);const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'只有管理員可以上傳文章圖片。');
  if(pool.active>=1)throw new AppError(429,'圖片處理忙碌，請稍後再試。');pool.active++;reserved=true;
  const bytes=await limitedBody(req,5*1024*1024+65536);
  let form:FormData;try{form=await new Request(req.url,{method:'POST',headers:req.headers,body:bytes as BodyInit}).formData();}catch{throw new AppError(400,'請使用圖片上傳表單。');}const file=form.get('file');
  if(!(file instanceof File)||!file.size||file.size>5*1024*1024)throw new AppError(400,'請選擇 5 MB 以內的 PNG、JPEG 或 WebP 圖片。');
  let output:Buffer,width:number,height:number;
  try{const source=Buffer.from(await file.arrayBuffer()),image=sharp(source,{limitInputPixels:16000000,animated:false}),meta=await image.metadata();
    if(!['png','jpeg','webp'].includes(meta.format||'')||(meta.pages||1)>1)throw new Error('Unsupported image');
    const result=await image.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer({resolveWithObject:true});
    output=result.data;width=result.info.width;height=result.info.height;
  }catch{throw new AppError(400,'圖片無法讀取；僅接受非動畫 PNG、JPEG、WebP，最多 1600 萬像素。');}
  if(output.length>4*1024*1024)throw new AppError(413,'處理後圖片仍過大，請縮小後再上傳。');
  const current=await identity(req);if(current.role!=='admin')throw new AppError(403,'管理權限已變更，請重新登入。');
  const d=getConnection();ensurePostSchema(d);
  const since=new Date(Date.now()-86400000).toISOString();
  if(Number((d.prepare('SELECT COUNT(*) n FROM site_post_images WHERE created_by=? AND created_at>=?').get(current.email,since) as any)?.n)>=100)throw new AppError(429,'每個管理員 24 小時內最多上傳 100 張文章圖片。');
  const id=randomUUID();d.prepare('INSERT INTO site_post_images VALUES(?,?,?,?,?)').run(id,output,'image/webp',current.email,new Date().toISOString());setActivityAction(req,'post.image.upload',id);
  return Response.json({id,src:'/api/posts/images?id='+id,width,height},{headers});
}catch(e){return fail(e instanceof HttpSecurityError?new AppError(e.status,e.message):e);}finally{if(reserved)pool.active--;}}
export async function POST(req:Request){return auditOperation(req,()=>upload(req));}
