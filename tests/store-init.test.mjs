import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

for (const legacy of [false, true]) {
  test(legacy ? "upgrades a version 1 database without losing members" : "initializes and reopens a fresh database", () => {
    const directory = mkdtempSync(join(tmpdir(), "aslung-init-"));
    const databasePath = join(directory, "test.sqlite");
    try {
      const setup = legacy ? `
        const old = new DatabaseSync(process.env.DATABASE_PATH);
        old.exec("CREATE TABLE members(email TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,password_hash TEXT NOT NULL); CREATE TABLE schema_version(version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES(1); INSERT INTO members VALUES('existing@example.com','existing-id','Existing','member',1,'hash');");
        old.close();
      ` : "";
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
        import assert from "node:assert/strict";
        import {DatabaseSync} from "node:sqlite";
        ${setup}
        const {getConnection} = await import(${JSON.stringify(new URL("../lib/store.mjs", import.meta.url).href)});
        const db = getConnection();
        assert.ok(db.prepare('PRAGMA table_info(maintainers)').all().some(column=>column.name==='english_name'));
        const maintainer=db.prepare('SELECT name FROM maintainers ORDER BY name LIMIT 1').get().name;
        db.prepare('UPDATE maintainers SET english_name=? WHERE name=?').run('Full English Display Name',maintainer);
        assert.equal(db.prepare("SELECT MAX(version) AS version FROM schema_version").get().version, 14);
        db.prepare("INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,?,?,?)").run('new@example.com','new-id','New','new-admin','admin',1,'hash');
        assert.throws(() => db.prepare("INSERT INTO members(email,user_id,name,nickname,role,active,password_hash) VALUES(?,?,?,?,?,?,?)").run('duplicate@example.com','duplicate-id','Duplicate','new-admin','admin',1,'hash'), /UNIQUE/);
        ${legacy ? `assert.equal(db.prepare("SELECT name FROM members WHERE email='existing@example.com'").get().name, 'Existing');` : ""}
        assert.equal(db.prepare("SELECT alert_email_enabled FROM members WHERE email='new@example.com'").get().alert_email_enabled,1);
        db.prepare("UPDATE members SET alert_email_enabled=0 WHERE email='new@example.com'").run();
        db.close();
        const {getConnection: reopen} = await import(${JSON.stringify(new URL("../lib/store.mjs?reopen", import.meta.url).href)});
        const reopened = reopen();
        assert.equal(reopened.prepare("SELECT name FROM members WHERE email='new@example.com'").get().name, 'New');
        assert.equal(reopened.prepare('SELECT english_name FROM maintainers WHERE name=?').get(maintainer).english_name,'Full English Display Name');
        assert.equal(reopened.prepare("SELECT alert_email_enabled FROM members WHERE email='new@example.com'").get().alert_email_enabled,0);
        reopened.close();
      `], {env: {...process.env, DATABASE_PATH: databasePath}, encoding: "utf8"});
      assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally {
      rmSync(directory, {recursive: true, force: true});
    }
  });
}
