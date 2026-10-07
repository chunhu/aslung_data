import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {hashPassword,verifyPassword,tokenHash} from "../lib/passwords.mjs";
test("password hashing rejects short input and verifies salted hashes",async()=>{
 await assert.rejects(hashPassword("short"));
 const hash=await hashPassword("LongTestPassword!123");
 assert.ok(!hash.includes("LongTestPassword"));
 assert.equal(await verifyPassword("LongTestPassword!123",hash),true);
 assert.equal(await verifyPassword("IncorrectPassword!123",hash),false);
 assert.equal(tokenHash("token").length,64);
});
test("store persists membership, enforces foreign keys and device-member uniqueness",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"aslung-test-"));process.env.DATABASE_PATH=join(directory,"test.sqlite");
 const {getConnection,getStore}=await import("../lib/store.mjs");const d=getConnection();
 d.prepare("INSERT INTO members VALUES(?,?,?,?,?,?)").run("test@example.com","id1","Test","member",1,"hash");
 assert.equal((await getStore().prepare("SELECT * FROM members WHERE email=?").bind("test@example.com").first()).name,"Test");
 d.prepare("INSERT INTO devices(id,name) VALUES(?,?)").run("A1","Station");
 assert.throws(()=>d.prepare("INSERT INTO grants VALUES(?,?,?,?)").run("A1","unknown@example.com","start","end"),/FOREIGN KEY/);
 d.prepare("INSERT INTO grants VALUES(?,?,?,?)").run("A1","test@example.com","start","end");
 assert.throws(()=>d.prepare("INSERT INTO grants VALUES(?,?,?,?)").run("A1","test@example.com","start","end"),/UNIQUE/);
 d.close();rmSync(directory,{recursive:true,force:true});
});
