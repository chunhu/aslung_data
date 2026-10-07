import {DatabaseSync} from "node:sqlite";
import {mkdirSync,chmodSync} from "node:fs";
import {resolve,dirname} from "node:path";
let connection;
export function getConnection(){
 if(connection)return connection;
 const path=resolve(process.env.DATABASE_PATH||"./data/aslung.sqlite");
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const d=new DatabaseSync(path);chmodSync(path,0o600);
 d.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
 d.exec(`
 CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS members(email TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','member')),active INTEGER NOT NULL DEFAULT 1,password_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS grants(id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL REFERENCES devices(id), email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE, start TEXT NOT NULL, end TEXT);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_email ON sessions(email);
 CREATE TABLE IF NOT EXISTS login_attempts(email TEXT PRIMARY KEY,window_start INTEGER NOT NULL,failures INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS device_locations(id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id TEXT NOT NULL, aslung_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE, start_time TEXT NOT NULL, end_time TEXT, active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS api_tokens(id TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES members(email) ON DELETE CASCADE, created_at TEXT NOT NULL);
 INSERT OR IGNORE INTO schema_version(version) VALUES(1);
 `);

 // Migration for nickname support
 const versionRow = d.prepare("SELECT MAX(version) as version FROM schema_version").get();
 const version = versionRow ? versionRow.version : 1;
 if (version < 2) {
   d.exec("ALTER TABLE members ADD COLUMN nickname TEXT; CREATE UNIQUE INDEX IF NOT EXISTS members_nickname ON members(nickname) WHERE nickname IS NOT NULL AND nickname != ''; UPDATE schema_version SET version=2;");
 }

 connection=d;return d;
}
export function getStore(){return {prepare(sql){let values=[];return {bind(...v){values=v;return this;},async first(){return getConnection().prepare(sql).get(...values)??null;},async all(){return {results:getConnection().prepare(sql).all(...values)};},async run(){return getConnection().prepare(sql).run(...values);}};}};}
