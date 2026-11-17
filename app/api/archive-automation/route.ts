import {identity,writeGuard,AppError,fail} from '@/lib/server';
import {limitedJson} from '@/lib/http-security.mjs';
import {auditOperation} from '@/lib/activity-server';
import {getConnection} from '@/lib/store.mjs';
import {archiveAutomationStatus,saveArchiveAutomation,retryArchiveAutomation} from '@/lib/archive-automation.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){try{const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'僅系統管理員可管理封存排程。');return Response.json(archiveAutomationStatus(getConnection()),{headers});}catch(e){return fail(e);}}
export async function POST(req:Request){return auditOperation(req,async()=>{try{writeGuard(req);const me=await identity(req);if(me.role!=='admin')throw new AppError(403,'僅系統管理員可管理封存排程。');const p=await limitedJson(req,16000),d=getConnection();if(p?.action==='save')saveArchiveAutomation(d,p,me.email);else if(p?.action==='retry')retryArchiveAutomation(d);else throw new AppError(400,'不支援的封存操作。');return Response.json(archiveAutomationStatus(d),{headers});}catch(e){return fail(new AppError((e as any).status||500,(e as Error).message));}});}
