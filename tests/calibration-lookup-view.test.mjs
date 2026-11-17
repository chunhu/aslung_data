import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function find(n,p){if(!React.isValidElement(n))return null;if(p(n))return n;for(const c of React.Children.toArray(n.props.children)){const found=find(c,p);if(found)return found;}return null;}
test('calibration lookup stays empty until keyword submission and clearing hides results again',async()=>{
 let index=0;const states=[],effects=[],calls=[];
 const RecordTable=()=>React.createElement('div',null,'RESULT_TABLE');
 const deps={react:{useState:initial=>{const i=index++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:v=>({current:v}),useCallback:f=>f,useEffect:f=>effects.push(f)},'react/jsx-runtime':jsx,
 '@/components/ProcessingJobs':{default:()=>null},'@/components/CalibrationHistory':{default:()=>null},'@/components/CalibrationRecordTable':{default:RecordTable},'@/components/ui/button':{Button:'button'},'@/components/ui/input':{Input:'input'},'@/components/ui/label':{Label:'label'},'@/components/ui/textarea':{Textarea:'textarea'},'@/components/ui/dialog':Object.fromEntries(['Dialog','DialogHeader','DialogContent','DialogTitle','DialogDescription'].map(k=>[k,({children})=>React.createElement('div',null,children)])),'lucide-react':Object.fromEntries(['Plus','RefreshCw','Pencil','CloudDownload','Trash2'].map(k=>[k,()=>null])),sonner:{toast:{}}};
 const code=ts.transpileModule(readFileSync(new URL('../components/CalibrationView.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,m={exports:{}};
 new Function('require','module','exports',code)(k=>{assert.ok(k in deps,k);return deps[k];},m,m.exports);
 const render=()=>{index=0;effects.length=0;return m.exports.default({api:async url=>{calls.push(url);return {sources:[],versions:[],logs:[],records:[{id:1}],total:1,hasMore:false};},isEnglish:false,formatTime:v=>v});};
 let tree=render();effects[0]();await new Promise(r=>setImmediate(r));
 tree=render();assert.match(renderToStaticMarkup(tree),/請輸入關鍵字/);assert.doesNotMatch(renderToStaticMarkup(tree),/RESULT_TABLE|cal-device-list/);
 find(tree,n=>n.props.id==='cal-device').props.onChange({target:{value:'AL-1143'}});tree=render();assert.equal(calls.length,1);
 find(tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});tree=render();effects[0]();await new Promise(r=>setImmediate(r));
 assert.equal(new URL('http://test'+calls.at(-1)).searchParams.get('q'),'AL-1143');assert.match(renderToStaticMarkup(render()),/RESULT_TABLE/);
 find(render(),n=>n.props.id==='cal-device').props.onChange({target:{value:''}});assert.doesNotMatch(renderToStaticMarkup(render()),/RESULT_TABLE/);
});
