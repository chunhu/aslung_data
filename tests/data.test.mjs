import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../lib/data.ts",import.meta.url),"utf8").replace('import {config,AppError} from "./server";','const config=()=>({url:"https://upstream.test/data",token:"test"});class AppError extends Error{constructor(status,message){super(message);this.status=status;}}');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {fetchPage,toCsv}=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));
test("measurement API preserves separate PN values and rejects device/time leakage",async()=>{
 const oldFetch=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({aslung_id:"A1",data:[{timestamp:"2026-10-01T08:00:00Z",pn23_cm3:125,pn10_cm3:98}],has_more:false,next_cursor:null});
  const result=await fetchPage("A1","2026-10-01T00:00:00Z","2026-10-02T00:00:00Z","");
  assert.equal(result.data[0].pn23_cm3,125);assert.equal(result.data[0].pn10_cm3,98);
  globalThis.fetch=async()=>Response.json({aslung_id:"B2",data:[],has_more:false});await assert.rejects(fetchPage("A1","2026-10-01T00:00:00Z","2026-10-02T00:00:00Z",""),e=>e.status===502);
  globalThis.fetch=async()=>Response.json({aslung_id:"A1",data:[{timestamp:"2026-10-03T00:00:00Z"}],has_more:false});await assert.rejects(fetchPage("A1","2026-10-01T00:00:00Z","2026-10-02T00:00:00Z",""),e=>e.status===502);
  globalThis.fetch=async()=>Response.json({aslung_id:"A1",data:[],has_more:true,next_cursor:"repeat"});await assert.rejects(fetchPage("A1","2026-10-01T00:00:00Z","2026-10-02T00:00:00Z","repeat"),e=>e.status===502);
 }finally{globalThis.fetch=oldFetch}
});
test("CSV has BOM, escapes text formulas and preserves negative numbers",()=>{
 const csv=toCsv([{timestamp:"2026-10-01T00:00:00Z",label:"=1+1",temperature_c:-2.5}]);
 assert.ok(csv.startsWith("\uFEFF"));assert.ok(csv.includes("'=1+1"));assert.ok(csv.includes('"-2.5"'));
});
