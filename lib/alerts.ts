import nodemailer from "nodemailer";
import { db, syncDeviceStatusesAndLocations } from "@/lib/server";
import { getPool } from "@/lib/data";

export interface AlertResult {
  checkedAt: string;
  totalDevices: number;
  offlineCount: number;
  notifiedMaintainers: number;
  skipped?: boolean;
  details: Array<{
    maintainer: string;
    email: string;
    deviceCount: number;
    devices: Array<{
      aslungId: string;
      labId: string;
      lastSeen: string | null;
      offlineMins: number;
    }>;
    status: string;
    error?: string;
  }>;
}

export function shouldRunScheduledCheck(settings: any, now = new Date()): boolean {
  if (!settings || !settings.enabled) return false;
  const lastCheck = settings.last_check_at ? new Date(settings.last_check_at) : null;
  const nowMs = now.getTime();
  const scheduleType = settings.schedule_type || "interval";

  if (scheduleType === "interval") {
    const intervalMins = Math.max(5, Number(settings.check_interval_mins) || 60);
    if (!lastCheck) return true;
    return (nowMs - lastCheck.getTime()) >= intervalMins * 60 * 1000;
  }

  // Daily or Weekly fixed time check in target timezone (default Asia/Taipei)
  const tz = settings.timezone || "Asia/Taipei";
  const nowFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    weekday: "short"
  });

  const parts = nowFormatter.formatToParts(now);
  const partMap: Record<string, string> = {};
  for (const p of parts) partMap[p.type] = p.value;

  const currentHour = parseInt(partMap.hour, 10);
  const currentMin = parseInt(partMap.minute, 10);
  const currentTimeMins = currentHour * 60 + currentMin;

  const [schedH, schedM] = (settings.schedule_time || "09:00").split(":").map((v: string) => parseInt(v, 10) || 0);
  const targetTimeMins = schedH * 60 + schedM;

  // Has current time reached target time today?
  if (currentTimeMins < targetTimeMins) {
    return false;
  }

  // Weekly check: verify if today is one of the active days of the week
  if (scheduleType === "weekly") {
    const dayNameMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const currentDayNum = dayNameMap[partMap.weekday] ?? now.getDay();
    const activeDays = (settings.schedule_days || "1,2,3,4,5").split(",").map((s: string) => parseInt(s.trim(), 10));
    if (!activeDays.includes(currentDayNum)) {
      return false;
    }
  }

  // If never checked before, execute now
  if (!lastCheck) return true;

  // Compare with last check date in target timezone
  const lastParts = nowFormatter.formatToParts(lastCheck);
  const lastMap: Record<string, string> = {};
  for (const p of lastParts) lastMap[p.type] = p.value;

  const isSameDay = lastMap.year === partMap.year && lastMap.month === partMap.month && lastMap.day === partMap.day;
  if (!isSameDay) {
    return true;
  }

  // Same day: check if lastCheck was before targetTimeMins
  const lastHour = parseInt(lastMap.hour, 10);
  const lastMin = parseInt(lastMap.minute, 10);
  const lastCheckTimeMins = lastHour * 60 + lastMin;

  return lastCheckTimeMins < targetTimeMins;
}

export async function checkAndSendOfflineAlerts(options: { force?: boolean } = {}): Promise<AlertResult> {
  const store = db();
  await syncDeviceStatusesAndLocations(store);
  const settingsRow: any = await store.prepare("SELECT * FROM alert_settings WHERE id=1").first();
  const settings = settingsRow || {
    enabled: 1,
    schedule_type: "interval",
    schedule_time: "09:00",
    schedule_days: "1,2,3,4,5",
    timezone: "Asia/Taipei",
    check_interval_mins: 60,
    offline_threshold_mins: 60,
    use_test_email: 0,
    smtp_host: "",
    smtp_port: 587,
    smtp_user: "",
    smtp_pass: "",
    smtp_from: ""
  };

  const now = new Date();
  const nowIso = now.toISOString();

  if (!options.force) {
    if (!settings.enabled || !shouldRunScheduledCheck(settings, now)) {
      return {
        checkedAt: nowIso,
        totalDevices: 0,
        offlineCount: 0,
        notifiedMaintainers: 0,
        skipped: true,
        details: []
      };
    }
  }

  const thresholdMins = Number(settings.offline_threshold_mins) || 60;

  // 1. Load active locations (where active = 1 and end_time is null/empty)
  const locsRes: any = await store.prepare("SELECT * FROM device_locations WHERE active = 1 AND (end_time IS NULL OR end_time = '') ORDER BY start_time DESC").all();
  const activeLocations: any[] = locsRes.results || [];
  const activeLocMap = new Map<string, any>();
  for (const l of activeLocations) {
    if (!activeLocMap.has(l.aslung_id)) {
      activeLocMap.set(l.aslung_id, l);
    }
  }

  // 2. Get all devices, and filter ONLY in-use devices (使用中 DEPLOYED)
  const devsRes: any = await store.prepare("SELECT id, name, location, status FROM devices").all();
  const allDevices: any[] = devsRes.results || [];
  const inUseDevices = allDevices.filter(d => {
    const isStatusOk = d.status === "DEPLOYED";
    const hasActiveLoc = activeLocMap.has(d.id);
    return isStatusOk && hasActiveLoc;
  });
  const inUseDevIds = inUseDevices.map(d => d.id);

  // 3. Query realtime timestamps from rawdata (MySQL) in parallel chunks
  const pool = getPool();
  const deviceLatest: Record<string, { timestamp: string; PM25?: string; temp?: string; rh?: string }> = {};

  const BATCH_SIZE = 8;
  for (let i = 0; i < inUseDevIds.length; i += BATCH_SIZE) {
    const batch = inUseDevIds.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (id) => {
      try {
        const sql = `SELECT time, ch2 AS \`PM2.5_G3\`, ch4 AS temperature, ch5 AS rh FROM rawdata WHERE uid = ? ORDER BY time DESC LIMIT 1`;
        const [rows]: any = await pool.query(sql, [id]);
        if (rows.length > 0) {
          const r = rows[0];
          const t = r.time instanceof Date ? r.time : new Date(r.time + 'Z');
          deviceLatest[id] = {
            timestamp: t.toISOString(),
            PM25: r['PM2.5_G3'] != null ? String(r['PM2.5_G3']) : undefined,
            temp: r.temperature != null ? String(r.temperature) : undefined,
            rh: r.rh != null ? String(r.rh) : undefined,
          };
        }
      } catch (e) {
        console.error("Error querying realtime in alert checker for", id, e);
      }
    }));
  }

  // 4. Load maintainers
  const maintsRes: any = await store.prepare("SELECT * FROM maintainers").all();
  const maintainersList: any[] = maintsRes.results || [];
  const maintainerMap = new Map<string, any>();
  for (const m of maintainersList) {
    maintainerMap.set(m.name.trim(), m);
  }

  // 5. Find offline devices (> thresholdMins) among in-use devices
  const offlineList: Array<{
    aslung_id: string;
    lab_id: string;
    maintainer: string;
    offline_mins: number;
    last_seen: string | null;
  }> = [];

  const nowMs = now.getTime();
  for (const d of inUseDevices) {
    const latest = deviceLatest[d.id];
    let offlineMins = 0;
    let lastSeen: string | null = null;
    if (!latest) {
      offlineMins = 99999;
    } else {
      offlineMins = Math.floor((nowMs - new Date(latest.timestamp).getTime()) / 60000);
      lastSeen = latest.timestamp;
    }

    if (offlineMins >= thresholdMins) {
      const activeLoc = activeLocMap.get(d.id);
      offlineList.push({
        aslung_id: d.id,
        lab_id: activeLoc?.lab_id || "未指定地點",
        maintainer: (activeLoc?.maintainer || "未指定負責人").trim(),
        offline_mins: offlineMins,
        last_seen: lastSeen,
      });
    }
  }

  // 6. Group offline devices by maintainer
  const groupedByMaintainer = new Map<string, typeof offlineList>();
  for (const item of offlineList) {
    const list = groupedByMaintainer.get(item.maintainer) || [];
    list.push(item);
    groupedByMaintainer.set(item.maintainer, list);
  }

  // 7. Setup Mail Transporter if SMTP configured
  const hasSmtp = !!(settings.smtp_host && settings.smtp_user && settings.smtp_pass);
  let transporter: any = null;
  if (hasSmtp) {
    try {
      transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port: Number(settings.smtp_port) || 587,
        secure: Number(settings.smtp_port) === 465,
        auth: {
          user: settings.smtp_user,
          pass: settings.smtp_pass,
        },
      });
    } catch (e) {
      console.error("Failed to create SMTP transporter:", e);
    }
  }

  const details: AlertResult["details"] = [];
  const logInsert = store.prepare(`
    INSERT INTO alert_logs (aslung_id, lab_id, maintainer, email, last_seen, offline_mins, status, error_message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 8. Process each maintainer group
  for (const [mName, items] of groupedByMaintainer.entries()) {
    const maintInfo = maintainerMap.get(mName);
    let targetEmail = "";
    if (maintInfo) {
      targetEmail = settings.use_test_email && maintInfo.email_test ? maintInfo.email_test : maintInfo.email;
    }

    let status = "SIMULATED";
    let errorMessage = "";

    if (hasSmtp && transporter && targetEmail) {
      try {
        const rowsHtml = items.map(it => `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 8px 12px; font-weight: bold; font-family: monospace;">${it.aslung_id}</td>
            <td style="padding: 8px 12px;">${it.lab_id}</td>
            <td style="padding: 8px 12px; color: #dc2626; font-weight: bold;">
              ${it.offline_mins >= 99999 ? "無資料" : `斷線約 ${it.offline_mins} 分鐘 (${(it.offline_mins/60).toFixed(1)} 小時)`}
            </td>
            <td style="padding: 8px 12px; font-family: monospace; font-size: 12px; color: #64748b;">
              ${it.last_seen ? new Date(it.last_seen).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "從未上傳"}
            </td>
          </tr>
        `).join("");

        const mailHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #0f766e; margin-top: 0;">ASLUNG 設備斷線告警通知</h2>
            <p style="color: #334155; font-size: 14px;">
              您好 <strong>${mName}</strong>，<br/>
              系統於定期監控檢查中發現，由您負責維護的 <strong>使用中 ASLUNG 設備</strong> 共有 <strong>${items.length} 台</strong> 已超過斷線門檻（${thresholdMins} 分鐘）未接收到新上傳數據。
            </p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px; text-align: left;">
              <thead>
                <tr style="background-color: #f8fafc; border-bottom: 2px solid #cbd5e1;">
                  <th style="padding: 8px 12px;">ASLUNG ID</th>
                  <th style="padding: 8px 12px;">目前位置</th>
                  <th style="padding: 8px 12px;">離線時間</th>
                  <th style="padding: 8px 12px;">最後上傳時間 (UTC+8)</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
            <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; margin: 20px 0; font-size: 12px; color: #991b1b;">
              請儘速確認儀器電源、Wi-Fi 網路訊號連線狀況與現場設置環境。
            </div>
            <p style="font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; margin-bottom: 0;">
              此郵件由 ASLUNG 空氣品質監測系統自動排程發送，請勿直接回覆。
            </p>
          </div>
        `;

        await transporter.sendMail({
          from: settings.smtp_from || `"ASLUNG 系統告警" <${settings.smtp_user}>`,
          to: targetEmail,
          subject: `[ASLUNG 設備斷線告警] 負責設備共 ${items.length} 台斷線超過 ${thresholdMins} 分鐘提醒 (負責人：${mName})`,
          html: mailHtml,
        });

        status = "SENT";
      } catch (err: any) {
        console.error(`Failed to send alert email to ${targetEmail}:`, err);
        status = "FAILED";
        errorMessage = err.message || "發送失敗";
      }
    } else {
      status = "SIMULATED";
      if (!targetEmail) {
        errorMessage = "未設定維護人員 Email";
      } else if (!hasSmtp) {
        errorMessage = "系統尚未設定 SMTP 伺服器，已建立模擬通知記錄";
      }
    }

    // Insert alert logs for each device
    for (const it of items) {
      try {
        await logInsert.bind(
          it.aslung_id,
          it.lab_id,
          mName,
          targetEmail || "無",
          it.last_seen,
          it.offline_mins,
          status,
          errorMessage,
          nowIso
        ).run();
      } catch (e) {
        console.error("Failed to insert alert log:", e);
      }
    }

    details.push({
      maintainer: mName,
      email: targetEmail || "無",
      deviceCount: items.length,
      devices: items.map(x => ({
        aslungId: x.aslung_id,
        labId: x.lab_id,
        lastSeen: x.last_seen,
        offlineMins: x.offline_mins
      })),
      status,
      error: errorMessage || undefined
    });
  }

  // Update last check & alert times in settings
  await store.prepare(`
    UPDATE alert_settings
    SET last_check_at = ?, last_alert_at = (CASE WHEN ? > 0 THEN ? ELSE last_alert_at END)
    WHERE id = 1
  `).bind(nowIso, offlineList.length, nowIso).run();

  return {
    checkedAt: nowIso,
    totalDevices: inUseDevices.length,
    offlineCount: offlineList.length,
    notifiedMaintainers: groupedByMaintainer.size,
    details
  };
}

let alertCronTimer: any = null;
export function initAlertCron() {
  if (alertCronTimer) return;
  alertCronTimer = setInterval(async () => {
    try {
      const store = db();
      const settings: any = await store.prepare("SELECT * FROM alert_settings WHERE id=1").first();
      if (settings && shouldRunScheduledCheck(settings)) {
        await checkAndSendOfflineAlerts();
      }
    } catch (e) {
      console.error("[AlertCron] Scheduled check error:", e);
    }
  }, 30000);
}
