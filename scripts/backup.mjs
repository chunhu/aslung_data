import {backup} from "node:sqlite";
import {mkdirSync,chmodSync} from "node:fs";
import {resolve} from "node:path";
import {getConnection} from "../lib/store.mjs";
const directory=resolve(process.env.BACKUP_PATH||"./backups");
mkdirSync(directory,{recursive:true,mode:0o700});
const path=resolve(directory,"aslung-"+new Date().toISOString().replaceAll(":","-")+".sqlite");
await backup(getConnection(),path);chmodSync(path,0o600);
console.log("備份完成："+path);
