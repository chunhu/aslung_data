import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {createServer} from "node:net";
import {randomUUID} from "node:crypto";
const dir=mkdtempSync(join(tmpdir(),"aslung-http-"));
process.env.DATABASE_PATH=join(dir,"test.sqlite");
const {getConnection}=await import("../lib/store.mjs");
const {hashPassword}=await import("../lib/passwords.mjs");
const d=getConnection();
const password="TestPassword!Long123";
d.prepare("INSERT INTO members VALUES(?,?,?,?,?,?)").run("owner@example.com",randomUUID(),"Owner","admin",1,await hashPassword(password));
const probe=createServer();await new Promise(r=>probe.listen(0,"127.0.0.1",r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin="http://127.0.0.1:"+port;
const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{env:{...process.env,APP_ORIGIN:origin,EC2_DATA_API_URL:"",EC2_DATA_API_TOKEN:""},stdio:["ignore","pipe","pipe"]});
let log="";child.stdout.on("data",c=>log+=c);child.stderr.on("data",c=>log+=c);
async function call(path,{method="GET",body,cookie="",headers={}}={}){
 return fetch(origin+path,{method,headers:{Origin:origin,"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
}
try{
 let ready=false;for(let i=0;i<60;i++){try{if((await call("/api/health")).ok){ready=true;break}}catch{}await delay(200)}
 assert.ok(ready,"Server did not start: "+log);
 assert.equal((await call("/api/manage")).status,401);
 assert.equal((await call("/api/manage",{headers:{"oai-authenticated-user-email":"owner@example.com","oai-authenticated-user-id":"forged"}})).status,401);
 assert.equal((await call("/api/auth/login",{method:"POST",body:{email:"owner@example.com",password:"wrong"}})).status,401);
 const login=await call("/api/auth/login",{method:"POST",body:{email:"owner@example.com",password}});
 assert.equal(login.status,200);const owner=login.headers.get("set-cookie").split(";")[0];assert.match(login.headers.get("set-cookie"),/HttpOnly/i);
 const ownerState=await (await call("/api/manage",{cookie:owner})).json();assert.equal(ownerState.me.role,"admin");
 const post=(body,cookie=owner)=>call("/api/manage",{method:"POST",cookie,body});
 assert.equal((await post({action:"device",id:"A1",name:"Station"})).status,200);
 assert.equal((await post({action:"member",email:"member@example.com",name:"Member",password})).status,200);
 assert.equal((await post({action:"grant",deviceId:"A1",email:"member@example.com",start:"2026-10-01T00:00:00Z",end:"2026-10-02T00:00:00Z"})).status,200);
 const mLogin=await call("/api/auth/login",{method:"POST",body:{email:"member@example.com",password}});assert.equal(mLogin.status,200);
 const member=mLogin.headers.get("set-cookie").split(";")[0];
 assert.equal((await post({action:"device",id:"A2",name:"No"},member)).status,403);
 const state=await (await call("/api/manage",{cookie:member})).json();assert.equal(state.devices.length,1);assert.equal(state.members.length,0);
 const q="/api/data?aslung_id=A1&start=2026-10-01T00%3A00%3A00Z&end=2026-10-02T00%3A00%3A00Z";
 assert.equal((await call(q,{cookie:member})).status,503);
 assert.equal((await call(q.replace("2026-10-01","2026-09-30"),{cookie:member})).status,403);
 assert.equal((await post({action:"revoke",deviceId:"A1",email:"member@example.com"})).status,200);
 assert.equal((await call(q,{cookie:member})).status,403);
 assert.equal((await call("/api/auth/password",{method:"POST",cookie:member,body:{currentPassword:password,password:"NewPassword!Long456"}})).status,200);
 assert.equal((await call("/api/manage",{cookie:member})).status,401);
 assert.equal((await call("/api/auth/login",{method:"POST",body:{email:"member@example.com",password}})).status,401);
 assert.equal((await call("/api/auth/login",{method:"POST",body:{email:"member@example.com",password:"NewPassword!Long456"}})).status,200);
 for(let i=0;i<5;i++)assert.equal((await call("/api/auth/login",{method:"POST",body:{email:"blocked@example.com",password:"IncorrectPassword12"}})).status,401);
 assert.equal((await call("/api/auth/login",{method:"POST",body:{email:"blocked@example.com",password:"IncorrectPassword12"}})).status,429);
 assert.equal((await post({action:"memberStatus",email:"member@example.com",active:false})).status,200);
 assert.equal((await call("/api/auth/login",{method:"POST",body:{email:"member@example.com",password:"NewPassword!Long456"}})).status,401);
 assert.equal((await call("/api/manage",{method:"POST",cookie:owner,body:{action:"device",id:"CSRF",name:"No"},headers:{Origin:"https://untrusted.example"}})).status,403);
 assert.equal((await call("/api/auth/logout",{method:"POST",cookie:owner})).status,200);
 assert.equal((await call("/api/manage",{cookie:owner})).status,401);
 console.log("PASS: actual production HTTP login, session cookies, forged-header rejection, member creation, grants, period enforcement, revocation, password change, disabled accounts, login rate limit, CSRF and logout.");
}finally{child.kill("SIGTERM");await new Promise(r=>child.once("exit",r));d.close();rmSync(dir,{recursive:true,force:true});}
