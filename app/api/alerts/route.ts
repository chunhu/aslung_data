import { NextRequest } from "next/server";
import { identity, db, fail, writeGuard, AppError } from "@/lib/server";
import { checkAndSendOfflineAlerts } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const me = await identity(req);
    if (me.role !== "admin") throw new AppError(403, "只有管理員可以查看告警設定。");

    const store = db();
    const settings = (await store.prepare("SELECT * FROM alert_settings WHERE id=1").first()) || {
      id: 1, enabled: 1, check_interval_mins: 60, offline_threshold_mins: 60, use_test_email: 0, smtp_host: "", smtp_port: 587, smtp_user: "", smtp_pass: "", smtp_from: ""
    };
    const logs = (await store.prepare("SELECT * FROM alert_logs ORDER BY created_at DESC LIMIT 100").all()).results;

    return Response.json({ settings, logs }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    writeGuard(req);
    const me = await identity(req);
    if (me.role !== "admin") throw new AppError(403, "只有管理員可以執行告警操作。");

    const body = await req.json() as Record<string, unknown>;
    const action = body?.action;

    if (action === "updateSettings") {
      const enabled = body.enabled ? 1 : 0;
      const checkInterval = Math.max(5, Number(body.check_interval_mins) || 60);
      const offlineThreshold = Math.max(5, Number(body.offline_threshold_mins) || 60);
      const useTestEmail = body.use_test_email ? 1 : 0;
      const smtpHost = String(body.smtp_host || "").trim();
      const smtpPort = Number(body.smtp_port) || 587;
      const smtpUser = String(body.smtp_user || "").trim();
      const smtpPass = body.smtp_pass ? String(body.smtp_pass) : "";
      const smtpFrom = String(body.smtp_from || "").trim();

      const store = db();
      if (smtpPass) {
        await store.prepare(`
          UPDATE alert_settings
          SET enabled=?, check_interval_mins=?, offline_threshold_mins=?, use_test_email=?,
              smtp_host=?, smtp_port=?, smtp_user=?, smtp_pass=?, smtp_from=?
          WHERE id=1
        `).bind(enabled, checkInterval, offlineThreshold, useTestEmail, smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom).run();
      } else {
        await store.prepare(`
          UPDATE alert_settings
          SET enabled=?, check_interval_mins=?, offline_threshold_mins=?, use_test_email=?,
              smtp_host=?, smtp_port=?, smtp_user=?, smtp_from=?
          WHERE id=1
        `).bind(enabled, checkInterval, offlineThreshold, useTestEmail, smtpHost, smtpPort, smtpUser, smtpFrom).run();
      }

      return Response.json({ ok: true });
    }

    if (action === "checkNow") {
      const result = await checkAndSendOfflineAlerts({ force: true });
      return Response.json({ ok: true, result });
    }

    throw new AppError(400, "不支援的操作。");
  } catch (e) {
    return fail(e);
  }
}
