// A warning remains visible even when it is excluded from email delivery.
export function ensureMaintainerNotificationSchema(d) {
  if (d.prepare('PRAGMA table_info(maintainers)').all().some(c => c.name === 'offline_email_enabled')) return;
  d.exec('BEGIN IMMEDIATE');
  try {
    if (!d.prepare('PRAGMA table_info(maintainers)').all().some(c => c.name === 'offline_email_enabled'))
      d.exec('ALTER TABLE maintainers ADD COLUMN offline_email_enabled INTEGER NOT NULL DEFAULT 1 CHECK(offline_email_enabled IN (0,1))');
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
}

export function alertEmailExclusion(lastSeen, now = new Date()) {
  if (!lastSeen) return '從未上傳資料，僅保留畫面警示';
  const last = new Date(lastSeen);
  if (!Number.isFinite(last.getTime()) || last > now) return '最後回報時間無效，未寄送通知';
  const cutoff = new Date(now);
  const month = cutoff.getUTCMonth();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  if (cutoff.getUTCMonth() !== month) cutoff.setUTCDate(0);
  return last < cutoff ? '斷線超過一年，僅保留畫面警示' : '';
}

export function alertRecipients(addresses, members) {
  const accounts = new Map(members.map(m => [String(m.email).trim().toLowerCase(), m]));
  return [...new Set(String(addresses || '').split(/[,;]+/).map(v => v.trim().toLowerCase()).filter(Boolean))]
    .filter(email => {
      const member = accounts.get(email);
      return !member || (Number(member.active) === 1 && Number(member.alert_email_enabled ?? 1) === 1);
    });
}
