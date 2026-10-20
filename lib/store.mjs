import {DatabaseSync} from "node:sqlite";
import {mkdirSync,chmodSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {initializeRegistrationSchema} from './registration.mjs';
import {ensureMemberAccessSchema} from './member-access.mjs';
import {ensureMaintainerLinkSchema} from './maintainer-links.mjs';
let connection;
export function getConnection(){
 if(connection)return connection;
 const path=resolve(process.env.DATABASE_PATH||"./data/aslung.sqlite");
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const d=new DatabaseSync(path);chmodSync(path,0o600);
 d.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
 d.exec(`
 CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS members(email TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','member','device_manager','calibration_manager','viewer')),active INTEGER NOT NULL DEFAULT 1,password_hash TEXT NOT NULL,nickname TEXT,login_count INTEGER NOT NULL DEFAULT 0,last_login_at TEXT);
 CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'DEPLOYED');
 CREATE TABLE IF NOT EXISTS grants(id INTEGER PRIMARY KEY AUTOINCREMENT, grant_type TEXT NOT NULL DEFAULT 'device' CHECK(grant_type IN ('device', 'lab')), device_id TEXT REFERENCES devices(id) ON DELETE CASCADE, lab_id TEXT REFERENCES labs(id) ON DELETE CASCADE, email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE, start TEXT NOT NULL, end TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_email ON sessions(email);
 CREATE TABLE IF NOT EXISTS login_attempts(email TEXT PRIMARY KEY,window_start INTEGER NOT NULL,failures INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS device_locations(id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id TEXT NOT NULL, aslung_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE, maintainer TEXT, start_time TEXT NOT NULL, end_time TEXT, active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS api_tokens(id TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL, mime_type TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', uploader_email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE, storage_path TEXT NOT NULL, download_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS file_grants(id INTEGER PRIMARY KEY AUTOINCREMENT, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE, created_at TEXT NOT NULL, UNIQUE(file_id, email));
 CREATE INDEX IF NOT EXISTS file_grants_email ON file_grants(email);
 INSERT OR IGNORE INTO schema_version(version) VALUES(1);
 `);

 const versionRow = d.prepare("SELECT MAX(version) as version FROM schema_version").get();
 const version = versionRow ? versionRow.version : 1;
 if (version < 2) {
   const columns = d.prepare("PRAGMA table_info(members)").all();
   if (!columns.some(column => column.name === "nickname")) {
     d.exec("ALTER TABLE members ADD COLUMN nickname TEXT;");
   }
   d.exec("CREATE UNIQUE INDEX IF NOT EXISTS members_nickname ON members(nickname) WHERE nickname IS NOT NULL AND nickname != ''; UPDATE schema_version SET version=2;");
 }
 if (version < 3) {
   try {
     d.exec("ALTER TABLE devices ADD COLUMN status TEXT NOT NULL DEFAULT 'DEPLOYED';");
   } catch {}
   d.exec("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(3);");
 }
 if (version < 4) {
   try {
     d.exec("ALTER TABLE device_locations ADD COLUMN maintainer TEXT;");
   } catch {}
   d.exec("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(4);");
 }
 if (version < 5) {
   try {
     d.exec(`
       CREATE TABLE IF NOT EXISTS files(
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         size INTEGER NOT NULL,
         mime_type TEXT NOT NULL,
         description TEXT NOT NULL DEFAULT '',
         uploader_email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE,
         storage_path TEXT NOT NULL,
         download_count INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL
       );
       CREATE TABLE IF NOT EXISTS file_grants(
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
         email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE,
         created_at TEXT NOT NULL,
         UNIQUE(file_id, email)
       );
       CREATE INDEX IF NOT EXISTS file_grants_email ON file_grants(email);
     `);
   } catch {}
   d.exec("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(5);");
 }
 if (version < 6) {
   try {
     d.exec("ALTER TABLE files ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;");
   } catch {}
   d.exec("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(6);");
 }
 if (version < 7) {
   try {
     d.exec(`
       CREATE TABLE IF NOT EXISTS labs(
         id TEXT PRIMARY KEY,
         city_name TEXT NOT NULL DEFAULT '',
         town_name TEXT NOT NULL DEFAULT '',
         location_name TEXT NOT NULL DEFAULT '',
         lat REAL,
         lon REAL,
         description TEXT NOT NULL DEFAULT '',
         height TEXT NOT NULL DEFAULT '',
         source TEXT NOT NULL DEFAULT '',
         command TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL
       );
       CREATE TABLE IF NOT EXISTS maintainers(
         name TEXT PRIMARY KEY,
         email TEXT NOT NULL,
         email_test TEXT NOT NULL DEFAULT '',
         phone TEXT NOT NULL DEFAULT '',
         notes TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL
       );
       CREATE TABLE IF NOT EXISTS alert_settings(
         id INTEGER PRIMARY KEY DEFAULT 1,
         enabled INTEGER NOT NULL DEFAULT 1,
         schedule_type TEXT NOT NULL DEFAULT 'interval',
         schedule_time TEXT NOT NULL DEFAULT '09:00',
         schedule_days TEXT NOT NULL DEFAULT '1,2,3,4,5',
         timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
         check_interval_mins INTEGER NOT NULL DEFAULT 60,
         offline_threshold_mins INTEGER NOT NULL DEFAULT 60,
         use_test_email INTEGER NOT NULL DEFAULT 0,
         smtp_host TEXT NOT NULL DEFAULT '',
         smtp_port INTEGER NOT NULL DEFAULT 587,
         smtp_user TEXT NOT NULL DEFAULT '',
         smtp_pass TEXT NOT NULL DEFAULT '',
         smtp_from TEXT NOT NULL DEFAULT '',
         last_check_at TEXT,
         last_alert_at TEXT,
         realtime_interval_secs INTEGER NOT NULL DEFAULT 60
       );
       INSERT OR IGNORE INTO alert_settings (id, enabled, check_interval_mins, offline_threshold_mins) VALUES (1, 1, 60, 60);
       CREATE TABLE IF NOT EXISTS alert_logs(
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         aslung_id TEXT NOT NULL,
         lab_id TEXT NOT NULL DEFAULT '',
         maintainer TEXT NOT NULL DEFAULT '',
         email TEXT NOT NULL DEFAULT '',
         last_seen TEXT,
         offline_mins INTEGER NOT NULL,
         status TEXT NOT NULL DEFAULT 'SENT',
         error_message TEXT,
         created_at TEXT NOT NULL
       );
     `);

     // Pre-seed known initial maintainers
     const now = new Date().toISOString();
     const initialMaintainers = [
       ['尤思喻', 'siyuyu@gate.sinica.edu.tw', 'lch0909@gate.sinica.edu.tw'],
       ['鄒明謙', 'marktsou09@gate.sinica.edu.tw', 'lch0909@gate.sinica.edu.tw'],
       ['介姿淇', 'tcchieh@gate.sinica.edu.tw', 'lch0909@gate.sinica.edu.tw'],
       ['水晨凱', 'kyle@gate.sinica.edu.tw', 'lch0909@gate.sinica.edu.tw'],
       ['張喻翔', 'yusiangchang@gate.sinica.edu.tw', 'lch0909@gate.sinica.edu.tw'],
       ['陳志鴻', 'hongloveblue@gate.sinica.edu.tw', 'lch0909@gate.sinica.edu.tw'],
       ['溫子瑤', 'zywen@gate.sinica.edu.tw', 'lch0909@gate.sinica.edu.tw'],
       ['葉柔辰', 'joyyeh100@gate.sinica.edu.tw', 'lch0909@gate.sinica.edu.tw'],
       ['詹惠閔', 'chm1014@gate.sinica.edu.tw', 'lch0909@gate.sinica.edu.tw'],
       ['劉純湖', 'lch0909@gate.sinica.edu.tw', 'lch0909@gate.sinica.edu.tw'],
       ['林希言', 'lin0092@gate.sinica.edu.tw', 'lch0909@gate.sinica.edu.tw'],
       ['徐丕璟', 'lch0909@gate.sinica.edu.tw', 'PjimHsu@gmail.com']
     ];
     const insertM = d.prepare("INSERT OR IGNORE INTO maintainers (name, email, email_test, phone, notes, created_at) VALUES (?, ?, ?, '', '', ?)");
     for (const [mName, mMail, mTest] of initialMaintainers) {
       insertM.run(mName, mMail, mTest, now);
     }
   } catch (err) {
     console.error("Migration 7 error:", err);
   }
   d.exec("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(7);");
 }
 if (version < 8) {
   try {
     d.exec("ALTER TABLE alert_settings ADD COLUMN realtime_interval_secs INTEGER NOT NULL DEFAULT 60;");
   } catch {}
   d.exec("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(8);");
 }
 if (version < 9) {
   try { d.exec("ALTER TABLE alert_settings ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'interval';"); } catch {}
   try { d.exec("ALTER TABLE alert_settings ADD COLUMN schedule_time TEXT NOT NULL DEFAULT '09:00';"); } catch {}
   try { d.exec("ALTER TABLE alert_settings ADD COLUMN schedule_days TEXT NOT NULL DEFAULT '1,2,3,4,5';"); } catch {}
   try { d.exec("ALTER TABLE alert_settings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Taipei';"); } catch {}
   d.exec("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(9);");
  }
  if (version < 10) {
    try {
      d.exec(`
        CREATE TABLE IF NOT EXISTS grant_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE,
          aslung_id TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
          reviewed_by TEXT,
          reviewed_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS grant_requests_email ON grant_requests(email);
        CREATE INDEX IF NOT EXISTS grant_requests_status ON grant_requests(status);

        CREATE TABLE IF NOT EXISTS alert_checks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          check_type TEXT NOT NULL DEFAULT 'MANUAL',
          total_devices INTEGER NOT NULL DEFAULT 0,
          offline_count INTEGER NOT NULL DEFAULT 0,
          notified_maintainers INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'COMPLETED',
          summary TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS alert_checks_created_at ON alert_checks(created_at);
      `);

      try {
        d.exec("ALTER TABLE alert_logs ADD COLUMN check_id INTEGER REFERENCES alert_checks(id) ON DELETE CASCADE;");
      } catch {}

      const existingLogs = d.prepare("SELECT DISTINCT created_at FROM alert_logs WHERE check_id IS NULL ORDER BY created_at ASC").all();
      for (const row of existingLogs) {
        const time = row.created_at;
        const countRow = d.prepare("SELECT COUNT(*) as cnt, COUNT(DISTINCT maintainer) as mcnt, status FROM alert_logs WHERE created_at=?").get(time);
        const insCheck = d.prepare("INSERT INTO alert_checks (check_type, total_devices, offline_count, notified_maintainers, status, created_at) VALUES ('SCHEDULED', 0, ?, ?, ?, ?)");
        const res = insCheck.run(countRow.cnt, countRow.mcnt, countRow.status || 'COMPLETED', time);
        d.prepare("UPDATE alert_logs SET check_id=? WHERE created_at=?").run(res.lastInsertRowid, time);
      }
    } catch (err) {
      console.error("Migration 10 error:", err);
    }
    d.exec("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(10);");
 }
 if (version < 11) {
   try {
     d.exec("ALTER TABLE members ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;");
   } catch {}
   try {
     d.exec("ALTER TABLE members ADD COLUMN last_login_at TEXT;");
   } catch {}
   try {
     d.exec(`
       CREATE TABLE IF NOT EXISTS login_logs (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE,
         ip TEXT,
         user_agent TEXT,
         created_at TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS login_logs_email ON login_logs(email);
       CREATE INDEX IF NOT EXISTS login_logs_created_at ON login_logs(created_at);
     `);
   } catch {}
   d.exec("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(11);");
 }
 if (version < 12) {
   try {
     d.exec(`
       CREATE TABLE IF NOT EXISTS site_stats (
         key TEXT PRIMARY KEY,
         value INTEGER NOT NULL DEFAULT 0,
         updated_at TEXT
       );
       CREATE TABLE IF NOT EXISTS site_visit_logs (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         path TEXT NOT NULL DEFAULT '/',
         ip TEXT,
         user_agent TEXT,
         email TEXT,
         date_key TEXT NOT NULL,
         created_at TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS site_visit_logs_date ON site_visit_logs(date_key);
       CREATE INDEX IF NOT EXISTS site_visit_logs_created ON site_visit_logs(created_at);
     `);
     const existingLogCount = d.prepare("SELECT COUNT(*) as cnt FROM login_logs").get()?.cnt || 0;
     const initialViews = Math.max(existingLogCount, 1);
     d.prepare("INSERT OR IGNORE INTO site_stats (key, value, updated_at) VALUES ('total_views', ?, ?)").run(initialViews, new Date().toISOString());
   } catch (err) {
     console.error("Migration 12 error:", err);
   }
   d.exec("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(12);");
 }
  if (version < 13) {
    try {
      d.exec(`
        PRAGMA foreign_keys=OFF;
        CREATE TABLE IF NOT EXISTS grants_v13 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          grant_type TEXT NOT NULL DEFAULT 'device' CHECK(grant_type IN ('device', 'lab')),
          device_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
          lab_id TEXT REFERENCES labs(id) ON DELETE CASCADE,
          email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE,
          start TEXT NOT NULL,
          end TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO grants_v13 (id, grant_type, device_id, lab_id, email, start, end)
          SELECT id, 'device', device_id, NULL, email, start, end FROM grants;
        DROP TABLE grants;
        ALTER TABLE grants_v13 RENAME TO grants;
        CREATE INDEX IF NOT EXISTS grants_email ON grants(email);
        CREATE INDEX IF NOT EXISTS grants_device_id ON grants(device_id);
        CREATE INDEX IF NOT EXISTS grants_lab_id ON grants(lab_id);
        PRAGMA foreign_keys=ON;
      `);
    } catch (err) {
      console.error("Migration 13 grants error:", err);
    }
    try {
      d.exec("ALTER TABLE grant_requests ADD COLUMN request_type TEXT NOT NULL DEFAULT 'device' CHECK(request_type IN ('device', 'lab'));");
    } catch {}
    try {
      d.exec("ALTER TABLE grant_requests ADD COLUMN lab_id TEXT;");
    } catch {}
    d.exec("DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(13);");
  }

 if(version < 14){
   d.exec('BEGIN IMMEDIATE');
   try {
     initializeRegistrationSchema(d);
     d.exec('DELETE FROM schema_version; INSERT INTO schema_version(version) VALUES(14); COMMIT;');
   }catch(e){d.exec('ROLLBACK');d.close();throw e;}
 }
 if(!d.prepare('PRAGMA table_info(maintainers)').all().some(column=>column.name==='english_name')){
   d.exec('BEGIN IMMEDIATE');
   try{
     if(!d.prepare('PRAGMA table_info(maintainers)').all().some(column=>column.name==='english_name'))d.exec("ALTER TABLE maintainers ADD COLUMN english_name TEXT NOT NULL DEFAULT '';");
     d.exec('COMMIT');
   }catch(e){d.exec('ROLLBACK');d.close();throw e;}
 }
 if(!d.prepare('PRAGMA table_info(members)').all().some(column=>column.name==='alert_email_enabled')){
   d.exec('BEGIN IMMEDIATE');
   try{
     if(!d.prepare('PRAGMA table_info(members)').all().some(column=>column.name==='alert_email_enabled'))d.exec("ALTER TABLE members ADD COLUMN alert_email_enabled INTEGER NOT NULL DEFAULT 1 CHECK(alert_email_enabled IN (0,1));");
     d.exec('COMMIT');
   }catch(e){d.exec('ROLLBACK');d.close();throw e;}
 }
 try{ensureMemberAccessSchema(d);ensureMaintainerLinkSchema(d);}catch(e){d.close();throw e;}
 connection=d;return d;
}
export function getStore(){return {prepare(sql){let values=[];return {bind(...v){values=v.map(x=>x===undefined?null:x);return this;},async first(){return getConnection().prepare(sql).get(...values)??null;},async all(){return {results:getConnection().prepare(sql).all(...values)};},async run(){return getConnection().prepare(sql).run(...values);}};}};}

export function recordSiteVisit({ path = "/", email = "", ip = "", userAgent = "" } = {}) {
  const d = getConnection();
  const now = new Date();
  const nowIso = now.toISOString();
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(now);
  try {
    d.prepare(`
      INSERT INTO site_stats (key, value, updated_at)
      VALUES ('total_views', 1, ?)
      ON CONFLICT(key) DO UPDATE SET value = value + 1, updated_at = excluded.updated_at
    `).run(nowIso);

    d.prepare(`
      INSERT INTO site_visit_logs (path, ip, user_agent, email, date_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(path, ip, userAgent ? userAgent.slice(0, 255) : "", email || "", dateKey, nowIso);
  } catch (e) {
    console.error("Failed to record site visit:", e);
  }
}

export function getSiteStats() {
  const d = getConnection();
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  try {
    const totalRow = d.prepare("SELECT value FROM site_stats WHERE key = 'total_views'").get();
    const totalViews = totalRow?.value || 0;
    const todayRow = d.prepare("SELECT COUNT(*) as cnt FROM site_visit_logs WHERE date_key = ?").get(dateKey);
    const todayViews = todayRow?.cnt || 0;
    return { totalViews, todayViews };
  } catch (e) {
    return { totalViews: 0, todayViews: 0 };
  }
}
