import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { identity, db, fail, writeGuard, AppError } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const me = await identity(req);
    const searchParams = req.nextUrl.searchParams;
    const fileId = searchParams.get("id");

    if (fileId) {
      const file: any = await db().prepare("SELECT * FROM files WHERE id=?").bind(fileId).first();
      if (!file) throw new AppError(404, "找不到此檔案。");

      if (me.role !== "admin") {
        const grant = await db().prepare("SELECT 1 FROM file_grants WHERE file_id=? AND email=?").bind(fileId, me.email).first();
        if (!grant) throw new AppError(403, "您尚未獲得此檔案的檢視或下載權限。");
      }

      if (!fs.existsSync(file.storage_path)) {
        throw new AppError(404, "檔案實體不存在於伺服器。");
      }

      const fileBuffer = fs.readFileSync(file.storage_path);
      const isDownload = searchParams.get("download") === "1";
      if (isDownload) {
        try {
          await db().prepare("UPDATE files SET download_count = download_count + 1 WHERE id=?").bind(fileId).run();
        } catch {}
      }
      const disposition = isDownload ? "attachment" : "inline";
      const encodedName = encodeURIComponent(file.name);

      return new Response(fileBuffer, {
        headers: {
          "Content-Type": file.mime_type || "application/octet-stream",
          "Content-Length": String(fileBuffer.length),
          "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
          "Cache-Control": "private, no-cache, no-store, must-revalidate"
        }
      });
    }

    if (me.role === "admin") {
      const files = (await db().prepare("SELECT * FROM files ORDER BY created_at DESC").all()).results;
      const grants = (await db().prepare("SELECT * FROM file_grants").all()).results;
      return Response.json({ files, grants }, { headers: { "Cache-Control": "no-store" } });
    } else {
      const files = (await db().prepare(`
        SELECT f.* FROM files f
        JOIN file_grants fg ON fg.file_id = f.id
        WHERE fg.email = ?
        ORDER BY f.created_at DESC
      `).bind(me.email).all()).results;
      return Response.json({ files, grants: [] }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    writeGuard(req);
    const me = await identity(req);
    if (me.role !== "admin") throw new AppError(403, "只有管理員可以上傳或管理檔案。");

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file || typeof file === "string") throw new AppError(400, "請選擇要上傳的檔案。");

      const description = String(formData.get("description") || "").trim();
      let emails: string[] = [];
      try {
        const rawEmails = formData.get("emails");
        if (typeof rawEmails === "string" && rawEmails) {
          emails = JSON.parse(rawEmails);
        }
      } catch {}

      const fileId = "f_" + crypto.randomUUID().replace(/-/g, "").substring(0, 16);
      const uploadDir = path.resolve("./data/uploads");
      fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });

      const ext = path.extname(file.name);
      const storagePath = path.join(uploadDir, `${fileId}${ext}`);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(storagePath, buffer);

      const now = new Date().toISOString();
      await db().prepare(`
        INSERT INTO files (id, name, size, mime_type, description, uploader_email, storage_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        fileId,
        file.name,
        file.size,
        file.type || "application/octet-stream",
        description,
        me.email,
        storagePath,
        now
      ).run();

      if (Array.isArray(emails) && emails.length > 0) {
        const insertGrant = db().prepare("INSERT OR IGNORE INTO file_grants (file_id, email, created_at) VALUES (?, ?, ?)");
        for (const em of emails) {
          if (typeof em === "string" && em.trim()) {
            insertGrant.bind(fileId, em.trim().toLowerCase(), now).run();
          }
        }
      }

      return Response.json({ ok: true, fileId });
    }

    const body = await req.json() as Record<string, unknown>;
    const action = body?.action;

    if (action === "fileDelete") {
      const fileId = String(body.id || "");
      if (!fileId) throw new AppError(400, "未指定檔案 ID。");
      const file: any = await db().prepare("SELECT * FROM files WHERE id=?").bind(fileId).first();
      if (file) {
        if (file.storage_path && fs.existsSync(file.storage_path)) {
          try { fs.unlinkSync(file.storage_path); } catch {}
        }
        await db().prepare("DELETE FROM file_grants WHERE file_id=?").bind(fileId).run();
        await db().prepare("DELETE FROM files WHERE id=?").bind(fileId).run();
      }
      return Response.json({ ok: true });
    }

    if (action === "fileGrantsUpdate") {
      const fileId = String(body.id || "");
      if (!fileId) throw new AppError(400, "未指定檔案 ID。");
      const emails = body.emails as string[];
      if (!Array.isArray(emails)) throw new AppError(400, "成員名單格式不正確。");

      await db().prepare("BEGIN").run();
      try {
        await db().prepare("DELETE FROM file_grants WHERE file_id=?").bind(fileId).run();
        const insertGrant = db().prepare("INSERT OR IGNORE INTO file_grants (file_id, email, created_at) VALUES (?, ?, ?)");
        const now = new Date().toISOString();
        for (const em of emails) {
          if (typeof em === "string" && em.trim()) {
            insertGrant.bind(fileId, em.trim().toLowerCase(), now).run();
          }
        }
        await db().prepare("COMMIT").run();
      } catch (e) {
        await db().prepare("ROLLBACK").run();
        throw e;
      }
      return Response.json({ ok: true });
    }

    throw new AppError(400, "不支援的操作。");
  } catch (e) {
    return fail(e);
  }
}
