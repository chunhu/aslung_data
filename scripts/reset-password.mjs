import {getConnection} from "../lib/store.mjs";
import {hashPassword} from "../lib/passwords.mjs";
import {ask,secret} from "./prompts.mjs";
try{
 const email=(await ask("要重設密碼的 Email：")).toLowerCase(),d=getConnection();
 if(!d.prepare("SELECT email FROM members WHERE email=?").get(email))throw new Error("找不到會員。");
 const password=await secret("新密碼（12 至 128 字元，不顯示）："),confirm=await secret("再次輸入新密碼：");if(password!==confirm)throw new Error("兩次密碼不一致。");
 const hash=await hashPassword(password);
 d.exec("BEGIN IMMEDIATE");try{d.prepare("UPDATE members SET password_hash=? WHERE email=?").run(hash,email);d.prepare("DELETE FROM sessions WHERE email=?").run(email);d.exec("COMMIT");}catch(e){d.exec("ROLLBACK");throw e;}
 console.log("密碼已重設，所有登入工作階段已失效。");
}catch(e){console.error(e.message);process.exitCode=1;}
