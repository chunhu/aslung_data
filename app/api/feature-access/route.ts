import {getConnection} from '@/lib/store.mjs';
import {identity,writeGuard,fail,AppError} from '@/lib/server';
import {limitedJson,HttpSecurityError} from '@/lib/http-security.mjs';
import {auditOperation,setActivityAction} from '@/lib/activity-server';
import {FeatureAccessError,featureAdminState,saveFeaturePolicy,saveSharedGroup} from '@/lib/feature-access.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
function failure(e:unknown){if(e instanceof FeatureAccessError||e instanceof HttpSecurityError)return fail(new AppError(e.status,e.message));if(e instanceof Error&&e.message.includes('UNIQUE constraint'))return fail(new AppError(409,'群組名稱已存在。'));return fail(e);}
export async function GET(r:Request){try{const me=await identity(r);return Response.json(featureAdminState(getConnection(),me,{preview_email:new URL(r.url).searchParams.get('preview_email')||undefined}),{headers});}catch(e){return failure(e);}}
async function post(r:Request){try{
 writeGuard(r);const me=await identity(r),p=await limitedJson(r,512*1024);if(!p||typeof p!=='object'||Array.isArray(p))throw new AppError(400,'設定格式不正確。');
 setActivityAction(r,'featureAccess.'+String(p.action),p.feature||p.id||'');
 if(p.action==='policySave')return Response.json(saveFeaturePolicy(getConnection(),me,p),{headers});
 if(['groupSave','groupDelete'].includes(p.action))return Response.json(saveSharedGroup(getConnection(),me,p),{headers});
 throw new AppError(400,'無效操作。');
 }catch(e){return failure(e);}}
export async function POST(r:Request){return auditOperation(r,()=>post(r));}
