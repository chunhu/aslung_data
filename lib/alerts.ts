import { alertEmailExclusion, alertRecipients } from "./alert-policy.mjs";
import {explicitAlertRecipients} from './maintainer-links.mjs';
import nodemailer from "nodemailer";
import { db, syncDeviceStatusesAndLocations } from "@/lib/server";
import { getPool } from "@/lib/data";
import {buildOfflineNotification} from './offline-notification.mjs';
import { acquireAlertLock } from "./alert-lock";

export interface AlertResult {
  checkId?: number;
  checkedAt: string;
  totalDevices: number;
  offlineCount: number;
  notifiedMaintainers: number;
  skipped?: boolean;
  skipReason?: string;
  unknownCount?: number;
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
  const lock = await acquireAlertLock(store);
  if (!lock) return {
    checkedAt: new Date().toISOString(), totalDevices: 0, offlineCount: 0,
    notifiedMaintainers: 0, skipped: true, skipReason: "已有告警檢查正在執行", details: []
  };
  try {
    return await runOfflineAlertCheck(store, options, lock.assertOwned);
  } finally {
    await lock.release();
  }
}

async function runOfflineAlertCheck(store: ReturnType<typeof db>, options: { force?: boolean }, assertOwned: () => Promise<void>): Promise<AlertResult> {
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
  const queryErrors = new Map<string, string>();

  const BATCH_SIZE = 8;
  for (let i = 0; i < inUseDevIds.length; i += BATCH_SIZE) {
    const batch = inUseDevIds.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (id) => {
      try {
        const sql = `SELECT time, ch2 AS \`PM2.5_G3\`, ch4 AS temperature, ch5 AS rh FROM rawdata WHERE uid = ? ORDER BY time DESC LIMIT 1`;
        let rows: any[];
        try {
          [rows] = await pool.query({ sql, timeout: 20000 }, [id]) as [any[], any];
        } catch (queryErr: any) {
          if (queryErr?.code === 'ECONNRESET' || queryErr?.code === 'PROTOCOL_CONNECTION_LOST') {
            [rows] = await pool.query({ sql, timeout: 20000 }, [id]) as [any[], any];
          } else {
            throw queryErr;
          }
        }
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
        queryErrors.set(id, "量測資料查詢失敗，設備連線狀態未知");
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
    if (queryErrors.has(d.id)) continue;
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
  for (const item of offlineList.filter(item => !alertEmailExclusion(item.last_seen, now))) {
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
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 60000,
        auth: {
          user: settings.smtp_user,
          pass: settings.smtp_pass,
        },
      });
    } catch (e) {
      console.error("Failed to create SMTP transporter:", e);
    }
  }

  const members = (await store.prepare("SELECT email, active, alert_email_enabled FROM members").all()).results;
  const details: AlertResult["details"] = [];
  const checkType = options.force ? "MANUAL" : "SCHEDULED";
  await assertOwned();
  const unknownSummary = queryErrors.size ? `，另有 ${queryErrors.size} 台查詢失敗（狀態未知，未計入斷線）` : "";
  const initialStatus = offlineList.length === 0 ? (queryErrors.size ? "FAILED" : "NORMAL") : "PENDING";
  const initialSummary = offlineList.length === 0
    ? `檢測 ${inUseDevices.length} 台使用中設備，${queryErrors.size ? "成功查詢的設備未發現斷線" : "全部正常連線"}`
    : `檢測 ${inUseDevices.length} 台使用中設備，發現 ${offlineList.length} 台斷線`;

  const checkInsertRes: any = await store.prepare(`
    INSERT INTO alert_checks (check_type, total_devices, offline_count, notified_maintainers, status, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(checkType, inUseDevices.length, offlineList.length, 0, initialStatus, initialSummary + unknownSummary, nowIso).run();

  const checkId = checkInsertRes?.lastInsertRowid ? Number(checkInsertRes.lastInsertRowid) : 0;

  // Reserve this schedule before any SMTP side effects. A crash after sending
  // must not cause the next poll/reboot to resend the same scheduled check.
  await store.prepare("UPDATE alert_settings SET last_check_at=? WHERE id=1").bind(nowIso).run();

  const logInsert = store.prepare(`
    INSERT INTO alert_logs (check_id, aslung_id, lab_id, maintainer, email, last_seen, offline_mins, status, error_message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [id, message] of queryErrors) {
    const loc = activeLocMap.get(id);
    await logInsert.bind(checkId || null, id, loc?.lab_id || "未指定地點",
      (loc?.maintainer || "未指定負責人").trim(), "", null, 0, "UNKNOWN", message, nowIso).run();
  }

  // 8. Process each maintainer group
  for (const [mName, items] of groupedByMaintainer.entries()) {
    await assertOwned();
    const maintInfo = maintainerMap.get(mName);
    const explicitRecipients=await explicitAlertRecipients(store,maintInfo);
    let targetEmail = "";
    if (maintInfo) {
      const primary = explicitRecipients??alertRecipients(maintInfo.email, members);
      const useTest = settings.use_test_email && maintInfo.email_test;
      // Test routing must also respect the primary owner's opt-out.
      const addresses = useTest ? (primary.length ? alertRecipients(maintInfo.email_test, members) : []) : primary;
      targetEmail = addresses.join(", ");
    }

    let status = "SIMULATED";
    let errorMessage = "";

    if ((explicitRecipients!==null||maintInfo?.email) && !targetEmail) {
      status = "SKIPPED";
      errorMessage = explicitRecipients!==null?"維護身分未關聯可收信的啟用會員，或收件會員已關閉告警通知，僅保留畫面警示":"收件會員已關閉告警通知或帳號已停用，僅保留畫面警示";
    } else if (hasSmtp && transporter && targetEmail) {
      try {
        const message=buildOfflineNotification({maintainer:mName,items,thresholdMins,checkId,checkedAt:now,unknownCount:queryErrors.size});
        await transporter.sendMail({
          from: settings.smtp_from || `"ASLUNG 系統通知 / ASLUNG Notifications" <${settings.smtp_user}>`,
          to: targetEmail,
          ...message,
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
          checkId || null,
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

  for (const item of offlineList) {
    const reason = alertEmailExclusion(item.last_seen, now);
    if (!reason) continue;
    await logInsert.bind(checkId || null, item.aslung_id, item.lab_id, item.maintainer,
      "", item.last_seen, item.offline_mins, "SKIPPED", reason, nowIso).run();
    details.push({maintainer:item.maintainer,email:"",deviceCount:1,
      devices:[{aslungId:item.aslung_id,labId:item.lab_id,lastSeen:item.last_seen,offlineMins:item.offline_mins}],
      status:"SKIPPED",error:reason});
  }
  const notifiedMaintainers = details.filter(d => d.status === "SENT").length;
  const suppressedCount = details.filter(d => d.status === "SKIPPED").reduce((n,d) => n+d.deviceCount,0);

  // Update check execution record
  let finalCheckStatus = "NORMAL";
  if (offlineList.length > 0) {
    const hasFailed = details.some(d => d.status === "FAILED");
    const hasSimulated = details.some(d => d.status === "SIMULATED");
    if (hasFailed) finalCheckStatus = "FAILED";
    else if (hasSimulated) finalCheckStatus = "SIMULATED";
    else finalCheckStatus = notifiedMaintainers ? "SENT" : "SKIPPED";
  }
  if (queryErrors.size) finalCheckStatus = "FAILED";
  const finalSummary = (offlineList.length === 0
    ? `檢測 ${inUseDevices.length} 台使用中設備，${queryErrors.size ? "成功查詢的設備未發現斷線" : "全部正常連線"}`
    : `檢測 ${inUseDevices.length} 台使用中設備，發現 ${offlineList.length} 台斷線，通知 ${notifiedMaintainers} 位負責人，${suppressedCount} 台僅警示未寄信`) + unknownSummary;

  if (checkId) {
    await store.prepare(`
      UPDATE alert_checks
      SET status = ?, summary = ?, notified_maintainers = ?
      WHERE id = ?
    `).bind(finalCheckStatus, finalSummary, notifiedMaintainers, checkId).run();
  }

  // Update last check & alert times in settings
  await store.prepare(`
    UPDATE alert_settings
    SET last_alert_at = (CASE WHEN ? > 0 THEN ? ELSE last_alert_at END)
    WHERE id = 1
  `).bind(notifiedMaintainers, nowIso).run();

  return {
    checkId,
    checkedAt: nowIso,
    totalDevices: inUseDevices.length,
    offlineCount: offlineList.length,
    unknownCount: queryErrors.size,
    notifiedMaintainers,
    details
  };
}

export function initAlertCron() {
  const state = globalThis as typeof globalThis & { aslungAlertCron?: ReturnType<typeof setInterval> };
  if (state.aslungAlertCron) return;
  state.aslungAlertCron = setInterval(async () => {
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
