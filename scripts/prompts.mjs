import {createInterface} from "node:readline/promises";
import {stdin,stdout} from "node:process";
export async function ask(text){const rl=createInterface({input:stdin,output:stdout});try{return (await rl.question(text)).trim();}finally{rl.close();}}
export function secret(text){return new Promise((resolve,reject)=>{
 if(!stdin.isTTY){reject(new Error("請在互動終端使用 -it，密碼不接受命令列參數。"));return;}
 stdout.write(text);let value="";stdin.setRawMode(true);stdin.resume();stdin.setEncoding("utf8");
 const finish=()=>{stdin.off("data",handler);stdin.setRawMode(false);stdin.pause();stdout.write("\n");};
 const handler=chunk=>{for(const ch of chunk){if(ch==="\r"||ch==="\n"){finish();resolve(value);return;}if(ch==="\u0003"){finish();reject(new Error("已取消"));return;}if(ch==="\u007f"||ch==="\b"){value=value.slice(0,-1);continue;}if(ch>=" "&&value.length<129)value+=ch;}};
 stdin.on("data",handler);
});}
