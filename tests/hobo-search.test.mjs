import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as dates from 'date-fns-tz';
import {renderToStaticMarkup} from 'react-dom/server';

function component(file,states,extra={}){
  let index=0;const updates=new Map();
  const tag=name=>({children,...props})=>React.createElement(name,Object.fromEntries(Object.entries(props).filter(([key])=>['disabled','role','aria-label','aria-selected'].includes(key))),children);
  const deps={react:{...React,useState:initial=>{const current=index++;return [current<states.length?states[current]:typeof initial==='function'?initial():initial,value=>updates.set(current,value)];},useEffect:()=>{},useRef:value=>({current:value})},
    'react/jsx-runtime':jsx,'date-fns-tz':dates,'@/components/ui/button':{Button:tag('button')},'@/components/ui/input':{Input:tag('input')},
    '@/components/ui/popover':{Popover:tag('div'),PopoverContent:tag('div'),PopoverTrigger:tag('div')},
    '@/components/HoboDeviceSelect':{default:()=>React.createElement('button',{role:'combobox'},'選擇 HOBO 設備')},
    '@/components/HoboDataSearch':{default:()=>React.createElement('section',null,'HOBO 資料搜尋')},
    '@/components/HoboSyncJobs':{default:()=>null},
    '@/components/HoboDeviceOverview':{default:()=>null},
    '@/components/HoboBatchCancel':{default:()=>null},
    '@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription'].map(name=>[name,tag('div')])),
    '@/components/HoboCleanup':{default:()=>null},'@/components/HoboCancelSync':{default:()=>null},
    '@/lib/hobo-rcec-loggers.json':{default:JSON.parse(readFileSync(new URL('../lib/hobo-rcec-loggers.json',import.meta.url),'utf8'))},...extra};
  const source=readFileSync(new URL('../components/'+file,import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name];},module,module.exports);
  return {View:module.exports.default,updates};
}
function find(tree,predicate){
  if(!React.isValidElement(tree))return null;if(predicate(tree))return tree;
  for(const child of React.Children.toArray(tree.props.children)){const result=find(child,predicate);if(result)return result;}return null;
}

test('device dropdown searches names and serials inside a bounded list and selects the requested device',()=>{
  const loggers=Array.from({length:24},(_,i)=>({serial:String(20720700+i),name:`RCEC_${20720700+i}`}));const chosen=[];
  const {View}=component('HoboDeviceSelect.tsx',[true,'20720712']);
  const tree=View({loggers,value:'',onChange:serial=>chosen.push(serial)}),html=renderToStaticMarkup(tree);
  assert.equal((html.match(/role="option"/g)||[]).length,1);assert.ok(html.includes('RCEC_20720712'));assert.ok(!html.includes('RCEC_20720711'));
  find(tree,node=>node.props.role==='option').props.onClick();assert.deepEqual(chosen,['20720712']);
  assert.match(html,/max-h-56 overflow-y-auto/);
});

test('main HOBO view replaces the 24-row device table with a picker, selected summary and separate data search',()=>{
  const loggers=Array.from({length:24},(_,i)=>({serial:String(20720700+i),name:`RCEC_${20720700+i}`,observations:0,archived:0}));
  const {View}=component('HoboView.tsx',[{configured:true,storage:'s3',loggers,jobs:[]},'','',false,'20720712']);
  const html=renderToStaticMarkup(React.createElement(View,{api:()=>assert.fail(),timezone:'Asia/Taipei'}));
  assert.ok(html.includes('HOBO 設備（24 台）'));assert.ok(html.includes('HOBO 資料搜尋'));assert.ok(html.includes('role="combobox"'));
  assert.ok(!html.includes('RCEC_20720711'));assert.ok(!html.includes('RCEC_20720713'));assert.ok(html.includes('本機／S3 筆數'));
  assert.equal((html.match(/<details open/g)||[]).length,0);assert.equal((html.match(/<tbody><tr/g)||[]).length,0);
});

test('data search sends timezone-correct dates and all filters, then builds a matching full CSV download link',async()=>{
  const calls=[];const states=['20720755','2026-10-01T00:00','2026-10-02T00:00','Temperature','sensor-1','°C',[],null,false,'',false,''];
  const {View,updates}=component('HoboDataSearch.tsx',states);
  const tree=View({api:async(url,options)=>{calls.push({url,options});return {rows:[{value:0}],next:null};},loggers:[{serial:'20720755',name:'RCEC'}],selectedSerial:'20720755',timezone:'Asia/Taipei',refreshKey:0});
  find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);const params=new URL(calls[0].url,'http://localhost').searchParams;
  assert.equal(params.get('start'),'2026-09-30T16:00:00.000Z');assert.equal(params.get('end'),'2026-10-01T16:00:00.000Z');
  assert.equal(params.get('measurement'),'Temperature');assert.equal(params.get('sensor'),'sensor-1');assert.equal(params.get('q'),'°C');assert.ok(calls[0].options.signal);
  const csv=new URL(updates.get(9),'http://localhost').searchParams;assert.equal(csv.get('action'),'csv');assert.equal(csv.has('after'),false);
  for(const key of ['serial','start','end','measurement','sensor','q'])assert.equal(csv.get(key),params.get(key));
});

test('data search renders zero values and offers matching downloads and more-results navigation',()=>{
  const states=['20720755','2026-10-01T00:00','2026-10-02T00:00','','','',[{logger_sn:'20720755',timestamp:'2026-10-01T00:00:00Z',value:0,unit:'mm',sensor_measurement_type:'Rain'}],200,true,'/api/hobo?action=csv',false,''];
  const {View}=component('HoboDataSearch.tsx',states);const html=renderToStaticMarkup(React.createElement(View,{api:()=>assert.fail(),loggers:[],selectedSerial:'20720755',timezone:'Asia/Taipei',refreshKey:0}));
  for(const label of ['HOBO 資料搜尋','感測器序號','資料關鍵字','下載全部符合資料','載入更多符合資料'])assert.ok(html.includes(label),label);
  assert.match(html,/>0<\/td>/);
});

test('bulk job controls block active-job deletion and require DELETE for deleting inactive records',()=>{
  const job={id:'one',serial:'20720755',start:'2025-01-01',end:'2026-10-21',cursor:'2025-01-01',status:'QUEUED'};
  let {View}=component('HoboSyncJobs.tsx',[new Set(['one']),null,'',false,'','']);
  let html=renderToStaticMarkup(React.createElement(View,{api:()=>assert.fail(),jobs:[job],timezone:'Asia/Taipei',onChange:()=>{}}));
  assert.match(html,/<button disabled="">批量刪除紀錄<\/button>/);assert.ok(html.includes('全選目前同步工作'));assert.ok(html.includes('請先批量取消'));
  const dialog={operation:'delete',ids:['one'],serials:[job.serial]};
  ({View}=component('HoboSyncJobs.tsx',[new Set(['one']),dialog,'',false,'','']));
  html=renderToStaticMarkup(React.createElement(View,{api:()=>assert.fail(),jobs:[{...job,status:'FAILED'}],timezone:'Asia/Taipei',onChange:()=>{}}));
  assert.match(html,/<button disabled="">確認刪除紀錄<\/button>/);assert.ok(html.includes('保留設備設定、本機及 S3 量測資料'));
  ({View}=component('HoboSyncJobs.tsx',[new Set(['one']),dialog,'DELETE',false,'','']));
  html=renderToStaticMarkup(React.createElement(View,{api:()=>assert.fail(),jobs:[{...job,status:'FAILED'}],timezone:'Asia/Taipei',onChange:()=>{}}));assert.match(html,/<button>確認刪除紀錄<\/button>/);
});

test('bulk confirmation sends the frozen selected job IDs rather than other visible or newly selected jobs',async()=>{
  const jobs=[{id:'one',serial:'20720755',status:'FAILED'},{id:'two',serial:'20611824',status:'FAILED'}],calls=[];
  const dialog={operation:'cancel',ids:['one'],serials:['20720755']};
  const {View}=component('HoboSyncJobs.tsx',[new Set(['one','two']),dialog,'',false,'','']);
  let changed=0;const tree=View({api:async(url,options)=>{calls.push(JSON.parse(options.body));return {cancelled:1,skipped:0};},jobs,timezone:'Asia/Taipei',onChange:()=>{changed++;}});
  find(tree,node=>node.props.children==='確認批量取消').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[{action:'jobsBulk',operation:'cancel',ids:['one'],confirmation:'CANCEL'}]);assert.equal(changed,1);
});


test('all-device overview is optional and renders every device with counts and first/last UTC times',()=>{
  const loggers=[{serial:'20720755',name:'first',observations:2,archived:10,first:'2025-01-01T00:00:00Z',latest:'2026-10-01T00:00:00Z'},{serial:'20611824',name:'empty',observations:0,archived:0,first:null,latest:null}];
  let {View}=component('HoboDeviceOverview.tsx',[]);
  let html=renderToStaticMarkup(React.createElement(View,{api:()=>assert.fail(),loggers,selectedSerial:'',onSelect:()=>{},refreshKey:0}));
  assert.ok(html.includes('顯示全部設備摘要'));assert.ok(!html.includes('<table'));
  const chosen=[];
  ({View}=component('HoboDeviceOverview.tsx',[true,{loggers,generated_at:'2026-10-27T00:00:00Z'},false,'',0]));
  const tree=View({api:()=>assert.fail(),loggers,selectedSerial:'20720755',onSelect:id=>chosen.push(id),refreshKey:0});html=renderToStaticMarkup(tree);
  for(const text of ['20720755','20611824','2025-01-01T00:00:00Z','2026-10-01T00:00:00Z','第一筆時間','最後一筆時間','請勿直接相加'])assert.ok(html.includes(text),text);
  assert.equal((html.match(/<tr/g)||[]).length,3);assert.match(html,/>0<\/td>/);
  find(tree,node=>node.props.children==='查詢此設備').props.onClick();assert.deepEqual(chosen,['20720755']);
});

test('registered device heading follows actual device count rather than the initial preset',()=>{
  const loggers=Array.from({length:25},(_,i)=>({serial:String(20720700+i),name:'device',observations:0,archived:0}));
  const {View}=component('HoboView.tsx',[{configured:true,loggers,jobs:[]},'','',false,'']);
  const html=renderToStaticMarkup(React.createElement(View,{api:()=>assert.fail(),timezone:'Asia/Taipei'}));assert.ok(html.includes('HOBO 設備（25 台）'));
});


test('overview loads only when expanded, and ignores a late response after closing',async()=>{
  const effects=[],calls=[];let resolveRequest;
  const react={...React,useState:initial=>[initial===false?true:initial,()=>{}],useEffect:effect=>effects.push(effect)};
  const {View}=component('HoboDeviceOverview.tsx',[],{react});
  View({api:(url,options)=>{calls.push({url,options});return new Promise(resolve=>{resolveRequest=resolve;});},loggers:[{serial:'20720755'}],selectedSerial:'',onSelect:()=>{},refreshKey:0});
  const cleanup=effects[0]();assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/hobo?action=overview');
  cleanup();assert.equal(calls[0].options.signal.aborted,true);resolveRequest({loggers:[],generated_at:''});await new Promise(resolve=>setImmediate(resolve));
  const collapsed=[];
  const {View:Closed}=component('HoboDeviceOverview.tsx',[],{react:{...React,useState:initial=>[initial,()=>{}],useEffect:effect=>collapsed.push(effect)}});
  Closed({api:()=>assert.fail('collapsed overview must not fetch'),loggers:[],selectedSerial:'',onSelect:()=>{},refreshKey:0});collapsed[0]();
});


test('sync job list shows device-wide local/S3 counts separately from fetched count and unknown devices',()=>{
  const jobs=[{id:'one',serial:'20611825',status:'QUEUED',observations:0,actor:'schedule'},{id:'two',serial:'20611824',status:'QUEUED',observations:5,actor:'admin@example.test'},{id:'three',serial:'20601874',status:'DONE',observations:12}];
  const {View}=component('HoboSyncJobs.tsx',[]);
  const html=renderToStaticMarkup(React.createElement(View,{api:()=>assert.fail(),jobs,totalJobs:42,loggers:[{serial:'20611825',observations:0,archived:3818313},{serial:'20611824',observations:0,archived:0}],timezone:'Asia/Taipei',onChange:()=>{}}));
  assert.ok(html.includes('定期排程'));assert.ok(html.includes('手動匯入'));assert.ok(html.includes('總共 42 筆，目前顯示 3 筆'));assert.ok(html.includes('設備資料筆數（本機／S3）'));assert.ok(html.includes('0 / 3,818,313'));assert.ok(html.includes('0 / 0'));
  assert.match(html,/>—<\/td>/);assert.ok(html.includes('已抓取筆數（含重疊）'));assert.ok(html.includes('非本次工作新增筆數'));
});


test('overview distinguishes hourly schedule from active manual work and uses refreshed live status',()=>{
  const snapshots=[{serial:'1',name:'one',enabled:1,observations:0,archived:0},{serial:'2',name:'two',enabled:1,observations:0,archived:0},{serial:'3',name:'three',enabled:0,observations:0,archived:0}];
  const {View}=component('HoboDeviceOverview.tsx',[true,{loggers:snapshots,generated_at:''},false,'',0]);
  const html=renderToStaticMarkup(React.createElement(View,{api:()=>assert.fail(),loggers:[{serial:'1',enabled:0,active_job_status:'RUNNING'},{serial:'2',enabled:1,interval_minutes:120,active_job_status:'QUEUED'},{serial:'3',enabled:0,active_job_status:null}],selectedSerial:'',onSelect:()=>{},refreshKey:0}));
  for(const text of ['定期同步','目前同步工作','同步中','排隊中','目前無執行工作'])assert.ok(html.includes(text));
  assert.match(html,/停用<\/td><td[^>]*>同步中/);assert.match(html,/啟用（每 120 分鐘）<\/td><td[^>]*>排隊中/);
});


test('settings submit explicit schedule origin instead of the manual import date, with a stale-write guard',async()=>{
  const old='2024-12-31T16:00:00.000Z',logger={serial:'12345678',name:'test',sync_from:old,enabled:1,observations:0,archived:0};
  const states=[{configured:true,loggers:[logger],jobs:[]},'','',false,'12345678','test',true,'12345678','2025-01-01',false,'2026-10-19T00:00','2026-10-28T00:00',0,'2026-10-27T00:00',{sync_from:old,enabled:1},'90','120'],calls=[];
  const {View}=component('HoboView.tsx',states);
  const tree=View({api:async(url,options)=>{if(options)calls.push(JSON.parse(options.body));return {loggers:[logger],jobs:[]};},timezone:'Asia/Taipei'});
  find(tree,node=>node.props.children==='儲存設備與排程').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[0].interval_minutes,90);assert.equal(calls[0].scheduleStart,'2026-10-26T16:00:00.000Z');assert.equal(calls[0].start,calls[0].scheduleStart);assert.deepEqual(calls[0].expectedSchedule,{sync_from:old,enabled:1});
  const html=renderToStaticMarkup(tree);assert.ok(html.includes('自動同步起日'));assert.ok(html.includes('手動匯入開始時間'));
});


test('batch cancel confirmation freezes device identities and sends no dates or token requirements',async()=>{
  const {View,updates}=component('HoboBatchCancel.tsx',[]);
  let tree=View({api:()=>assert.fail(),serialsText:'12345678\n87654321,12345678',onSuccess:()=>{}});
  find(tree,node=>node.props.children==='批量取消工作並停用排程').props.onClick();assert.deepEqual(updates.get(0),['12345678','87654321']);
  const calls=[],results=[];
  const {View:Confirmed}=component('HoboBatchCancel.tsx',[['12345678','87654321'],false,'']);
  tree=Confirmed({api:async(url,options)=>{calls.push(JSON.parse(options.body));return {matched:2,disabled:1,cancelled:3,missing:[]};},serialsText:'99999999',onSuccess:r=>results.push(r)});
  find(tree,node=>node.props.children==='確認批量取消並停用').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[{action:'cancelBatch',serials:['12345678','87654321'],confirmation:'CANCEL'}]);assert.equal(results.length,1);
});

test('batch cancel rejects empty or malformed device lists without opening confirmation',()=>{
  for(const serialsText of ['', '12345678 bad']){
    const {View,updates}=component('HoboBatchCancel.tsx',[]);const tree=View({api:()=>assert.fail(),serialsText,onSuccess:()=>{}});
    find(tree,node=>node.props.children==='批量取消工作並停用排程').props.onClick();assert.ok(updates.get(2));assert.equal(updates.has(0),false);
  }
});


test('batch import submits a custom interval separately from API request pacing',async()=>{
  const states=[{configured:true,loggers:[],jobs:[]},'','',false,'','',false,'12345678','2026-10-27',true,'2026-10-19T00:00','2026-10-28T00:00',0,'2026-10-27T00:00',null,'60','180'],calls=[];
  const {View}=component('HoboView.tsx',states);
  const tree=View({api:async(url,options)=>{if(options)calls.push(JSON.parse(options.body));return {saved:1,queued:1,skipped:0,loggers:[],jobs:[]};},timezone:'Asia/Taipei'});
  find(tree,node=>node.props.children==='儲存並從起日匯入至今').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[0].interval_minutes,180);assert.equal(calls[0].enabled,true);assert.equal(calls[0].action,'batch');
});
