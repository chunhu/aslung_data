import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from "node:crypto";
import {promisify} from "node:util";
const scrypt=promisify(scryptCallback);
export function validPassword(value){return typeof value==="string"&&value.length>=12&&value.length<=128;}
export async function hashPassword(value){
 if(!validPassword(value))throw new Error("密碼需為 12 至 128 個字元。");
 const salt=randomBytes(16).toString("hex"),key=await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return "scrypt$"+salt+"$"+key.toString("hex");
}
export async function verifyPassword(value,hash){
 if(typeof value!=="string"||value.length>128)return false;
 const [method,salt,encoded]=String(hash).split("$");
 if(method!=="scrypt"||!salt||!encoded)return false;
 const expected=Buffer.from(encoded,"hex");const key=await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return expected.length===key.length&&timingSafeEqual(expected,key);
}
export const tokenHash=token=>createHash("sha256").update(token).digest("hex");
