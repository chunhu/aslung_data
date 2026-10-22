import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {identity, AppError, fail} from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const types: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export async function GET(request: Request, context: {params: Promise<{file: string}>}) {
  try {
    const {file} = await context.params;
    const match = /^ASLUNG_Website_User_Manual_(ZH|EN)\.(html|md|docx)$/.exec(file);
    if (!match) throw new AppError(404, '找不到此說明文件。');
    const me = await identity(request);
    if (me.role !== 'admin') throw new AppError(403, '只有系統管理員可以存取完整網站說明。');
    const content = await readFile(join(process.cwd(), 'docs', file));
    return new Response(new Uint8Array(content), {headers: {
      'Content-Type': types[match[2]],
      'Cache-Control': 'private, no-store',
      'Vary': 'Cookie, Authorization, X-API-Key',
      'Content-Disposition': `${match[2] === 'html' ? 'inline' : 'attachment'}; filename="${file}"`,
    }});
  } catch (error) {
    const response = fail(error);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', 'Cookie, Authorization, X-API-Key');
    return response;
  }
}
