import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {limitedJson,HttpSecurityError} from '@/lib/http-security.mjs';
import {auditOperation,setActivityAction} from '@/lib/activity-server';
import {getConnection} from '@/lib/store.mjs';
import {getHomepageSettings,saveHomepageSettings,HomepageSettingsError} from '@/lib/homepage-settings.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
function failure(e:unknown){return fail(e instanceof HomepageSettingsError||e instanceof HttpSecurityError?new AppError(e.status,e.message):e);}
export async function GET(req:Request){try{const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'只有管理員可以查看首頁設定。');return Response.json(getHomepageSettings(getConnection(),me),{headers});}catch(e){return failure(e);}}
async function save(req:Request){try{writeGuard(req);const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'只有管理員可以修改首頁設定。');const input=await limitedJson(req,1024*1024);setActivityAction(req,'homepage.settings','homepage');return Response.json(saveHomepageSettings(getConnection(),me,input),{headers});}catch(e){return failure(e);}}
export async function POST(req:Request){return auditOperation(req,()=>save(req));}
