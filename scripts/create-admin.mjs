import {randomUUID} from "node:crypto";
import {getConnection} from "../lib/store.mjs";
import {hashPassword} from "../lib/passwords.mjs";
import {ask,secret} from "./prompts.mjs";
try{
 const email=(await ask("管理員 Email：")).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Email 格式不正確。");
 const name=await ask("管理員姓名：");if(!name||name.length>160)throw new Error("請輸入姓名（最多 160 字）。");
 const password=await secret("密碼（12 至 128 字元，不顯示）："),confirm=await secret("再次輸入密碼：");if(password!==confirm)throw new Error("兩次密碼不一致。");
 const hash=await hashPassword(password);
 getConnection().prepare("INSERT INTO members(email,user_id,name,role,active,password_hash) VALUES(?,?,?,'admin',1,?)").run(email,randomUUID(),name,hash);
 console.log("管理員已建立。");
}catch(e){console.error(e.message.includes("UNIQUE")?"此 Email 已存在；請使用重設密碼工具。":e.message);process.exitCode=1;}
