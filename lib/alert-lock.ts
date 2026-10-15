import { randomUUID } from "node:crypto";

// All server bundles/processes share this lease through the existing SQLite file.
export async function acquireAlertLock(store: any, leaseMs = 120000) {
  await store.prepare(`CREATE TABLE IF NOT EXISTS alert_execution_lock (
    id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires_at INTEGER NOT NULL
  )`).run();
  const owner = randomUUID();
  const now = Date.now();
  const acquired = await store.prepare(`
    INSERT INTO alert_execution_lock(id, owner, expires_at) VALUES(1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at
    WHERE alert_execution_lock.expires_at <= ? RETURNING owner
  `).bind(owner, now + leaseMs, now).first();
  if (!acquired) return null;

  let lost = false;
  async function assertOwned() {
    if (lost) throw new Error("告警執行鎖已失效，已停止本次處理。");
    const current = Date.now();
    const renewed = await store.prepare(`UPDATE alert_execution_lock SET expires_at=?
      WHERE id=1 AND owner=? AND expires_at>? RETURNING owner`)
      .bind(current + leaseMs, owner, current).first();
    if (!renewed) {
      lost = true;
      throw new Error("告警執行鎖已失效，已停止本次處理。");
    }
  }
  const heartbeat = setInterval(() => {
    void assertOwned().catch(() => { lost = true; });
  }, Math.max(10, Math.floor(leaseMs / 4)));
  heartbeat.unref();
  return {
    assertOwned,
    async release() {
      clearInterval(heartbeat);
      await store.prepare("DELETE FROM alert_execution_lock WHERE id=1 AND owner=?").bind(owner).run();
    }
  };
}
