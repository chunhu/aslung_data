import nodemailer from "nodemailer";
import { db } from "@/lib/server";
import { getPool } from "@/lib/data";

export interface AlertResult {
  checkedAt: string;
  totalDevices: number;
  offlineCount: number;
  notifiedMaintainers: number;
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

export async function checkAndSendOfflineAlerts(options: { force?: boolean } = {}): Promise<AlertResult> {
  const store = db();
  const settingsRow: any = await store.prepare("SELECT * FROM alert_settings WHERE id=1").first();
  const settings = settingsRow || {
    enabled: 1,
    check_interval_mins: 60,
    offline_threshold_mins: 60,
    use_test_email: 0,
    smtp_host: "",
    smtp_port: 587,
    smtp_user: "",
    smtp_pass: "",
    smtp_from: ""
  };

  if (!options.force && !settings.enabled) {
    return {
      checkedAt: new Date().toISOString(),
      totalDevices: 0,
      offlineCount: 0,
      notifiedMaintainers: 0,
      details: []
    };
  }

  const thresholdMins = Number(settings.offline_threshold_mins) || 60;
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Load active locations (where active = 1)
  const locsRes: any = await store.prepare("SELECT * FROM device_locations WHERE active = 1 ORDER BY start_time DESC").all();
  const activeLocations: any[] = locsRes.results || [];
  const activeLocMap = new Map<string, any>();
  for (const l of activeLocations) {
    if (!activeLocMap.has(l.aslung_id)) {
      activeLocMap.set(l.aslung_id, l);
    }
  }

  // 2. Get all devices, and filter ONLY in-use devices
  // 「只有使用中的才要檢查」：
  // (1) 設備在設備追蹤內必須是有「使用中」(active = 1) 的位置紀錄
  // (2) 設備本身狀態不可為「已報廢」(RETIRED)、「維修中」(MAINTENANCE) 或「遺失」(LOST)
  const devsRes: any = await store.prepare("SELECT id, name, location, status FROM devices").all();
  const allDevices: any[] = devsRes.results || [];
  const inUseDevices = allDevices.filter(d => {
    const isStatusOk = d.status === "DEPLOYED" || !d.status || (d.status !== "RETIRED" && d.status !== "MAINTENANCE" && d.status !== "LOST");
    const hasActiveLoc = activeLocMap.has(d.id);
    return isStatusOk && hasActiveLoc;
  });
  const inUseDevIds = inUseDevices.map(d => d.id);

  // 3. Query realtime timestamps from rawdata (MySQL) - 僅針對使用中設備查詢
  const pool = getPool();
  const deviceLatest: Record<string, { timestamp: string; PM25?: string; temp?: string; rh?: string }> = {};

  for (const id of inUseDevIds) {
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
    aslungId: string;
    labId: string;
    maintainerName: string;
    lastSeen: string | null;
    offlineMins: number;
    PM25?: string;
    temp?: string;
    rh?: string;
  }> = [];

  for (const d of inUseDevices) {
    const latest = deviceLatest[d.id];
    let offlineMins = 0;
    let lastSeenStr: string | null = null;

    if (!latest) {
      offlineMins = 99999;
      lastSeenStr = null;
    } else {
      const diffMs = now.getTime() - new Date(latest.timestamp).getTime();
      offlineMins = Math.floor(diffMs / 60000);
      lastSeenStr = latest.timestamp;
    }

    if (offlineMins >= thresholdMins) {
      const activeLoc = activeLocMap.get(d.id);
      const labId = activeLoc?.lab_id || d.location || "未指定地點";
      const maintainerName = (activeLoc?.maintainer || "未指定負責人").trim();

      offlineList.push({
        aslungId: d.id,
        labId,
        maintainerName,
        lastSeen: lastSeenStr,
        offlineMins,
        PM25: latest?.PM25,
        temp: latest?.temp,
        rh: latest?.rh,
      });
    }
  }

  // 5. Group by maintainer
  const groupedByMaintainer = new Map<string, typeof offlineList>();
  for (const item of offlineList) {
    const list = groupedByMaintainer.get(item.maintainerName) || [];
    list.push(item);
    groupedByMaintainer.set(item.maintainerName, list);
  }

  // 6. Setup mail transporter if configured
  let transporter: any = null;
  const hasSmtp = Boolean(settings.smtp_host && settings.smtp_user && settings.smtp_pass);
  if (hasSmtp) {
    try {
      transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port: Number(settings.smtp_port) || 587,
        secure: Number(settings.smtp_port) === 465,
        auth: {
          user: settings.smtp_user,
          pass: settings.smtp_pass
        }
      });
    } catch (e) {
      console.error("Failed to initialize mail transporter:", e);
    }
  }

  // 7. Process each maintainer group & send / log alerts
  const details: AlertResult['details'] = [];
  const logInsert = store.prepare(`
    INSERT INTO alert_logs (aslung_id, lab_id, maintainer, email, last_seen, offline_mins, status, error_message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [mName, items] of groupedByMaintainer.entries()) {
    const mInfo = maintainerMap.get(mName);
    const targetEmail = mInfo ? (settings.use_test_email && mInfo.email_test ? mInfo.email_test : mInfo.email) : "";

    let status = "SIMULATED";
    let errorMessage = "";

    if (hasSmtp && transporter && targetEmail) {
      try {
        const rowsHtml = items.map((it, idx) => `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 10px; text-align: center;">${idx + 1}</td>
            <td style="padding: 10px; font-weight: bold; font-family: monospace;">${it.aslungId}</td>
            <td style="padding: 10px;">${it.labId}</td>
            <td style="padding: 10px; color: #dc2626; font-weight: bold;">斷線約 ${it.offlineMins === 99999 ? '超過7天' : it.offlineMins + ' 分鐘'}</td>
            <td style="padding: 10px; font-size: 12px; color: #64748b;">${it.lastSeen ? new Date(it.lastSeen).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '尚無紀錄'}</td>
            <td style="padding: 10px; font-size: 12px;">${it.PM25 ? `PM2.5: ${it.PM25} | 溫: ${it.temp || '-'}°C | 濕: ${it.rh || '-'}%` : '—'}</td>
          </tr>
        `).join("");

        const mailHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 680px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="background: #ef4444; color: white; padding: 12px 20px; border-radius: 6px; margin-bottom: 16px;">
              <h2 style="margin: 0; font-size: 18px;">⚠️ ASLUNG 設備斷線告警通知</h2>
            </div>
            <p style="font-size: 15px; color: #334155;">維護人員 <strong>${mName}</strong> 您好：</p>
            <p style="font-size: 14px; color: #475569; line-height: 1.6;">
              系統監測到由您負責的下列 <strong>${items.length}</strong> 台設備已斷線超過 <strong>${thresholdMins}</strong> 分鐘未回報量測數據，請協助確認設備電源、網路或現場通訊狀態：
            </p>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 18px 0; border: 1px solid #e2e8f0;">
              <thead>
                <tr style="background: #f8fafc; border-bottom: 2px solid #cbd5e1; color: #475569;">
                  <th style="padding: 10px; width: 40px;">#</th>
                  <th style="padding: 10px; text-align: left;">ASLUNG ID</th>
                  <th style="padding: 10px; text-align: left;">擺放地點 (Lab ID)</th>
                  <th style="padding: 10px; text-align: left;">斷線狀態</th>
                  <th style="padding: 10px; text-align: left;">最後上線 (UTC+8)</th>
                  <th style="padding: 10px; text-align: left;">最後量測數值</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
            <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #94a3b8; text-align: right;">
              ASLUNG 資料管理平台 · 自動監控告警系統<br/>發送時間：${now.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
            </div>
          </div>
        `;

        await transporter.sendMail({
          from: settings.smtp_from || `"ASLUNG 系統監控" <${settings.smtp_user}>`,
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
          it.aslungId,
          it.labId,
          mName,
          targetEmail || "無",
          it.lastSeen,
          it.offlineMins,
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
        aslungId: x.aslungId,
        labId: x.labId,
        lastSeen: x.lastSeen,
        offlineMins: x.offlineMins
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
