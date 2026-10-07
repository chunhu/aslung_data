"use client";
import {useState,useEffect,useCallback,useRef,useMemo} from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import FontSizeAdjuster from "@/components/FontSizeAdjuster";
import {Activity,Database,Users,ShieldCheck,Download,Plus,RefreshCw,Code2,Server,LockKeyhole,FileJson,LogOut,CheckCircle2,Unplug,Search,Trash2, MapPin, Key, RadioTower, Upload, Pencil, Check, ChevronsUpDown, ArrowRightLeft} from "lucide-react";
import {Button} from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Tabs,TabsList,TabsTrigger,TabsContent} from "@/components/ui/tabs";
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from "@/components/ui/table";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from "@/components/ui/alert-dialog";
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from "@/components/ui/select";
import {SidebarProvider,Sidebar,SidebarHeader,SidebarContent,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarTrigger} from "@/components/ui/sidebar";
import {Empty,EmptyHeader,EmptyTitle,EmptyDescription,EmptyMedia} from "@/components/ui/empty";
import {Skeleton} from "@/components/ui/skeleton";
import {Toaster,toast} from "sonner";

type Device={id:string;name:string;location:string;description:string;start?:string;end?:string};
type Member={email:string;name:string;nickname?:string|null;role:string;active:number};
type Grant={id:number;device_id:string;email:string;start:string;end:string|null};
type DeviceLocation={id:number;lab_id:string;aslung_id:string;start_time:string;end_time:string|null;active:number};
type ApiToken={id:string;created_at:string};
type State={me:{email:string;name:string;role:string};devices:Device[];members:Member[];grants:Grant[];locations:DeviceLocation[];tokens:ApiToken[];connected:boolean};
type Page={data:Record<string,unknown>[];next_cursor:string|null;has_more:boolean};
const pick=(value:string,onChange:(s:string)=>void,items:{value:string;label:string}[],placeholder:string)=><Select value={value} onValueChange={onChange}><SelectTrigger className="w-full h-11 bg-white"><SelectValue placeholder={placeholder}/></SelectTrigger><SelectContent>{items.map(x=><SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>;
function Blank({title,description,icon:Icon=Database}:{title:string;description:string;icon?:typeof Database}){return <Empty className="empty-area"><EmptyHeader><EmptyMedia variant="icon"><Icon/></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription className="text-sm">{description}</EmptyDescription></EmptyHeader></Empty>;}
async function request(url:string,init?:RequestInit){const r=await fetch(url,init);const p:any=await r.json();if(!r.ok)throw new Error(p.error??"操作失敗，請稍後重試。");return p;}

function SidebarResizer() {
  const isResizing = useRef(false);
  return (
    <div
      className="absolute top-0 right-[-3px] w-[6px] h-full cursor-col-resize hover:bg-blue-400 z-50 transition-colors"
      onMouseDown={(e) => {
        isResizing.current = true;
        const wrapper = document.getElementById("sidebar-provider");
        if (!wrapper) return;
        const startX = e.clientX;
        const startWidth = parseInt(wrapper.style.getPropertyValue('--sidebar-width') || '245');
        
        const onMouseMove = (ev: MouseEvent) => {
           if (!isResizing.current) return;
           document.body.style.userSelect = 'none'; // prevent text selection while dragging
           const delta = ev.clientX - startX;
           let nw = startWidth + delta;
           if (nw < 160) nw = 160;
           if (nw > 600) nw = 600;
           wrapper.style.setProperty('--sidebar-width', nw + 'px');
        };
        const onMouseUp = () => {
           isResizing.current = false;
           document.body.style.userSelect = '';
           document.removeEventListener('mousemove', onMouseMove);
           document.removeEventListener('mouseup', onMouseUp);
           localStorage.setItem("aslung_sidebar", wrapper.style.getPropertyValue('--sidebar-width'));
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }}
    />
  );
}

export default function Workspace({signedIn,signInUrl}:{signedIn:boolean;signInUrl:string}){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(signedIn),[section,setSection]=useState("data"),[modal,setModal]=useState(""),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState<any>(null);
 const [id,setId]=useState(""),[start,setStart]=useState(""),[end,setEnd]=useState(""),[page,setPage]=useState<Page|null>(null),[queried,setQueried]=useState<{id:string;start:string;end:string}|null>(null),[search,setSearch]=useState("");
 const [grantDevice,setGrantDevice]=useState(""),[grantEmail,setGrantEmail]=useState(""),[grantId,setGrantId]=useState<number|null>(null);
  const [tz, setTz] = useState<string>("Asia/Taipei");
  const [tzOpen, setTzOpen] = useState(false);
  const [editDevice, setEditDevice] = useState<any>(null);
  const [editMember, setEditMember] = useState<any>(null);
  const [transferDevice, setTransferDevice] = useState<any>(null);
  const allTimeZones = useMemo(() => {
    if (typeof Intl === 'undefined' || !Intl.supportedValuesOf) {
      return [{ tz: "Asia/Taipei", label: "(UTC+08:00) Asia / Taipei" }];
    }
    const tzs = Intl.supportedValuesOf('timeZone');
    const now = new Date();
    const mapped = tzs.map(tz => {
      try {
        const str = now.toLocaleString('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
        const match = str.match(/GMT([+-][0-9:]+)?/);
        const offset = match && match[1] ? match[1] : "+00:00";
        const sign = offset.startsWith('-') ? -1 : 1;
        const parts = offset.replace(/[+-]/, '').split(':');
        const offsetVal = sign * (parseInt(parts[0]) * 60 + parseInt(parts[1]));
        return { tz, label: `(UTC${offset}) ${tz.replace(/\//g, ' / ').replace(/_/g, ' ')}`, offsetVal };
      } catch { return null; }
    }).filter(Boolean) as {tz:string, label:string, offsetVal:number}[];
    mapped.sort((a, b) => b.offsetVal - a.offsetVal || a.tz.localeCompare(b.tz));
    return mapped;
  }, []);

  useEffect(() => {
    const sw = localStorage.getItem("aslung_sidebar");
    if (sw) {
      const el = document.getElementById("sidebar-provider");
      if (el) el.style.setProperty("--sidebar-width", sw);
    }
  }, []);

  useEffect(() => {
    if (!start && tz) {
      try {
        const todayStr = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
        setStart(todayStr + "T00:00");
        setEnd(todayStr + "T23:59");
      } catch {}
    }
  }, [tz, start]);

  useEffect(() => {
    let saved = localStorage.getItem("aslung_tz");
    if (!saved) {
      saved = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Taipei";
      localStorage.setItem("aslung_tz", saved);
    }
    setTz(saved);
  }, []);

  const today = useCallback(() => {
    try { return formatInTimeZone(new Date(), tz, "yyyy-MM-dd"); } catch { return "2024-01-01"; }
  }, [tz]);

  const localTime = useCallback((s: string) => {
    try { return formatInTimeZone(new Date(s), tz, "yyyy/MM/dd HH:mm:ss"); } catch { return s; }
  }, [tz]);

  const zoned = useCallback((s: string) => {
    try { return fromZonedTime(s, tz).toISOString(); } catch { return new Date(s).toISOString(); }
  }, [tz]);

 const [realtimeData, setRealtimeData] = useState<any[]|null>(null);
 const [realtimeSearch, setRealtimeSearch] = useState("");
 useEffect(()=>{ if(section==="realtime"){ setBusy(true); request("/api/realtime").then(setRealtimeData).catch(e=>toast.error(e.message)).finally(()=>setBusy(false)); const timer=setInterval(()=>request("/api/realtime").then(setRealtimeData).catch(()=>{}), 60000); return ()=>clearInterval(timer); } }, [section]);
 const admin=state?.me.role==="admin",devices=state?.devices??[],members=state?.members??[],grants=state?.grants??[],locations=state?.locations??[],tokens=state?.tokens??[];
 const load=useCallback(async()=>{setLoading(true);try{const s=await request("/api/manage");setState(s);setError("");}catch(e){setError((e as Error).message);}finally{setLoading(false)}},[]);
 useEffect(()=>{if(signedIn)void load()},[signedIn,load]);
 useEffect(()=>{setPage(null);setQueried(null)},[id,start,end]);
 async function mutate(p:any){setBusy(true);try{await request("/api/manage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});await load();setModal("");setConfirmation(null);toast.success("已儲存變更");return true;}catch(e){toast.error((e as Error).message);return false;}finally{setBusy(false)}}
 async function query(params:{id:string;start:string;end:string},cursor=""){setBusy(true);try{const q=new URLSearchParams({aslung_id:params.id,start:params.start,end:params.end,cursor});const p=await request("/api/data?"+q);setPage(p);setQueried(params);return {count:p.data.length,has_more:p.has_more};}catch(e){setPage(null);setQueried(null);toast.error((e as Error).message);throw e;}finally{setBusy(false)}}
 function parameters(){if(!id||!start||!end)throw new Error("請選擇 ASLUNG ID 和完整查詢期間。");const s=zoned(start),e=zoned(end);if(s>e)throw new Error("結束時間必須晚於開始時間。");return {id,start:s,end:e};}
 async function download(format:string){setBusy(true);try{const p=parameters(),q=new URLSearchParams({aslung_id:p.id,start:p.start,end:p.end,format,download:"1"}),r=await fetch("/api/data?"+q);if(!r.ok)throw new Error((await r.json() as any).error);const href=URL.createObjectURL(await r.blob()),a=document.createElement("a");a.href=href;a.download=p.id+"_"+start.slice(0,10)+"_"+end.slice(0,10)+"."+format;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);toast.success("下載完成");}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}
 useEffect(()=>{const context=(document as any).modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();void Promise.resolve(context.registerTool({name:"query_aslung_data",title:"查詢 ASLUNG 量測資料",description:"依授權設備與 UTC 期間查詢一頁量測資料，並更新頁面結果。",inputSchema:{type:"object",properties:{aslung_id:{type:"string"},start:{type:"string"},end:{type:"string"}},required:["aslung_id","start","end"],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async(input:any)=>{if(!input||typeof input.aslung_id!=="string"||!Number.isFinite(Date.parse(input.start))||!Number.isFinite(Date.parse(input.end))||Date.parse(input.start)>Date.parse(input.end))throw new Error("無效查詢參數");if(!devices.some(d=>d.id===input.aslung_id))throw new Error("未授權的設備");setSection("data");setId(input.aslung_id);const local=(v:string)=>formatInTimeZone(new Date(v), tz, "yyyy-MM-dd'T'HH:mm");setStart(local(input.start));setEnd(local(input.end));return query({id:input.aslung_id,start:new Date(input.start).toISOString(),end:new Date(input.end).toISOString()});}},{signal:lifecycle.signal})).catch(()=>{});return()=>lifecycle.abort();},[devices]);
 const labels:Record<string,string>={realtime:"即時線上狀態",data:"資料查詢",devices:"ASLUNG ID 管理",members:"會員管理",permissions:"資料授權",locations:"位置追蹤",connection:"系統連線狀態"};
 const nav=[{id:"realtime",name:"即時線上狀態",icon:RadioTower},{id:"data",name:"資料查詢",icon:Activity},{id:"devices",name:"ASLUNG ID 管理",icon:Database},{id:"members",name:"會員管理",icon:Users},{id:"permissions",name:"資料授權",icon:ShieldCheck},{id:"locations",name:"位置追蹤",icon:MapPin},{id:"connection",name:"系統連線狀態",icon:Code2}];
 const filtered=devices.filter(d=>{const loc=locations.find(l=>l.aslung_id===d.id&&l.active)?.lab_id||"";return (d.id+" "+(d.description||"")+" "+loc).toLowerCase().includes(search.toLowerCase())});
 const chosen=devices.find(d=>d.id===id); let columns=Array.from(new Set((page?.data??[]).flatMap(Object.keys)));if(columns.includes("timestamp"))columns=["timestamp",...columns.filter(c=>c!=="timestamp")];
 
 const parseAndImportCsv = async (text: string) => {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    const devicesToImport = [];
    for (const line of lines) {
      const idx = line.indexOf(',');
      let id = line;
      let loc = "";
      if (idx !== -1) {
        id = line.substring(0, idx).trim();
        loc = line.substring(idx + 1).trim();
      }
      id = id.replace(/^["']|["']$/g, "");
      loc = loc.replace(/^["']|["']$/g, "");
      if (id && /^[A-Za-z0-9_-]+$/.test(id)) {
        devicesToImport.push({ id, labId: loc });
      }
    }
    if (!devicesToImport.length) {
      toast.error("找不到有效的設備資料");
    } else {
      if (confirm(`確定要匯入 ${devicesToImport.length} 筆設備嗎？`)) {
        await mutate({ action: "deviceImport", devices: devicesToImport });
        toast.success(`成功匯入 ${devicesToImport.length} 筆設備`);
        setModal("");
      }
    }
 };
 const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    await parseAndImportCsv(text);
  } catch (err) {
    toast.error("讀取檔案失敗");
  } finally {
    e.target.value = "";
  }
 };
 return <SidebarProvider id="sidebar-provider" style={{"--sidebar-width":"245px"} as React.CSSProperties}><Toaster richColors position="top-center"/>
 <Sidebar className="nav-rail"><SidebarResizer /><SidebarHeader className="brand"><div className="brand-mark"><Activity size={24}/></div><div><strong>ASLUNG</strong><span>DATA MANAGEMENT</span></div></SidebarHeader><SidebarContent><div className="nav-caption">工作空間</div><SidebarMenu className="px-4">{nav.filter(n=>!signedIn||!state||admin||["realtime","data","connection"].includes(n.id)).map(n=><SidebarMenuItem key={n.id}><SidebarMenuButton className="nav-button" isActive={section===n.id} onClick={()=>{setSection(n.id);setSearch("")}}><n.icon/><span>{n.name}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu><div className="rail-note"><LockKeyhole size={18}/><strong>依會員授權存取</strong><p>設備與資料期間由管理員指定。</p></div></SidebarContent><SidebarFooter className="rail-footer"><div className="avatar">{state?.me.name?.slice(0,1)??"A"}</div><div className="identity"><strong>{state?.me.name??"ASLUNG 工作空間"}</strong><span>{state?(admin?"管理員":"會員"):"請登入後使用"}</span>{signedIn&&<button className="block text-xs underline mt-1" onClick={()=>setModal("password")}>變更密碼</button>}</div>{signedIn&&<Button variant="ghost" size="icon" aria-label="登出" onClick={async()=>{try{await request("/api/auth/logout",{method:"POST"});window.location.assign("/login")}catch(e){toast.error((e as Error).message)}}}><LogOut size={17}/></Button>}</SidebarFooter></Sidebar>
 <main className="workspace"><header className="topbar"><div className="flex items-center gap-3"><SidebarTrigger title="顯示/隱藏側邊欄"/><span className="breadcrumb">工作空間 <span>/</span> <strong>{labels[section]}</strong></span></div><div className="top-meta"><FontSizeAdjuster /><LanguageSwitcher />
<Select value={tz} onValueChange={v => { setTz(v); localStorage.setItem("aslung_tz", v); }}>
  <SelectTrigger className="w-56 h-8 text-xs bg-white/50 border-slate-200"><SelectValue/></SelectTrigger>
  <SelectContent>
    {allTimeZones.map(t => <SelectItem key={t.tz} value={t.tz}>{t.label}</SelectItem>)}
  </SelectContent>
</Select>
</div></header>
 <div className="main-inner"><div className="page-heading"><div><p className="eyebrow">ASLUNG DATA HUB</p><h1>{labels[section]}</h1><p className="subheading">{{realtime:"檢視所有授權設備的最後回報狀態與數值。",data:"選擇設備與期間，查詢並下載您有權限的量測資料。",devices:"建立設備識別資料，作為資料查詢與授權的依據。",members:"管理可登入工作空間的會員帳號。",permissions:"指定每位會員可存取的設備與資料期間。",locations:"追蹤設備分配至各實驗室或國外的擺放位置歷史紀錄。",connection:"透過 JSON 交換資料，連接 AWS EC2 量測資料來源。"}[section]}</p></div>{signedIn&&state&&<Button variant="outline" disabled={loading} onClick={()=>void load()}><RefreshCw size={15} className={loading?"animate-spin":""}/>重新整理</Button>}</div>
 {!signedIn?<section className="panel welcome"><div className="welcome-icon"><ShieldCheck size={38}/></div><div className="absolute top-4 right-4 flex items-center gap-2"><FontSizeAdjuster /><LanguageSwitcher /></div><p className="eyebrow">安全資料存取</p><h2>登入您的 ASLUNG 工作空間</h2><p>使用 Email 與密碼登入，查看您的設備與資料授權。<br/>管理員可建立 ASLUNG ID、開通會員與指定資料期間。</p><Button asChild size="lg"><a href={signInUrl} target="_top">使用 Email 登入</a></Button><div className="welcome-foot"><LockKeyhole size={14}/>帳號由管理員建立；請使用您的 Email 與密碼登入。</div></section>:error?<section className="panel"><Blank title="無法開啟工作空間" description={error} icon={LockKeyhole}/><div className="text-center pb-8"><Button onClick={()=>void load()}>重試</Button></div></section>:!state?<div className="panel p-8 space-y-5"><Skeleton className="h-9 w-48"/><Skeleton className="h-32 w-full"/></div>:<>
 <div className="stats"><div><span>可存取設備</span><strong>{devices.length.toString().padStart(2,"0")}</strong><Database/></div><div><span>{admin?"有效會員":"帳號權限"}</span><strong>{admin?members.filter(m=>m.active&&m.role==="member").length.toString().padStart(2,"0"):"會員"}</strong><Users/></div><div><span>{admin?"資料授權":"授權期間"}</span><strong>{admin?grants.length.toString().padStart(2,"0"):"依設備設定"}</strong><ShieldCheck/></div>{admin&&<div><span>資料來源</span><strong className="source-stat">AWS EC2</strong><span className={state.connected?"status ok":"status pending"}>{state.connected?"已設定連線":"待串接"}</span></div>}</div>
 {section==="realtime"&&<><section className="panel results"><div className="results-heading"><div><h2>設備即時線上狀態</h2><p>顯示授權設備的最新一筆量測紀錄（每分鐘自動更新）。</p></div><div className="flex gap-2 items-center"><Input placeholder="搜尋 ID 或位置" className="w-48 bg-white h-9" value={realtimeSearch} onChange={e=>setRealtimeSearch(e.target.value)} /><Button variant="outline" size="sm" disabled={busy} onClick={()=>{setBusy(true);request("/api/realtime").then(setRealtimeData).catch(e=>toast.error(e.message)).finally(()=>setBusy(false))}}><RefreshCw size={15} className={busy?"animate-spin":""}/>更新</Button></div></div>{!realtimeData?<div className="p-8"><Skeleton className="h-32 w-full"/></div>:realtimeData.length===0?<Blank title="沒有任何設備數據" description="尚無授權設備或設備未上傳過資料。"/>:(()=>{const filtered=(realtimeData||[]).filter(r=>{if(!realtimeSearch)return true;const s=realtimeSearch.toLowerCase();const loc=locations.find(l=>l.aslung_id===r.aslung_id&&l.active)?.lab_id||"";return String(r.aslung_id).toLowerCase().includes(s)||loc.toLowerCase().includes(s);});return <div className="table-scroll"><Table><TableHeader><TableRow><TableHead>狀態</TableHead><TableHead>目前位置</TableHead><TableHead>timestamp</TableHead><TableHead>aslung_id</TableHead><TableHead>PM1_G3</TableHead><TableHead>PM2.5_G3</TableHead><TableHead>PM10_G3</TableHead><TableHead>temperature</TableHead><TableHead>rh</TableHead><TableHead>co2</TableHead><TableHead>PM1_GSA</TableHead><TableHead>PM2.5_GSA</TableHead><TableHead>PM10_GSA</TableHead></TableRow></TableHeader><TableBody>{filtered.length===0?<TableRow><TableCell colSpan={13} className="text-center py-8 text-slate-500">沒有符合搜尋條件的設備</TableCell></TableRow>:filtered.map((r,i)=>{const isOffline=Date.now()-new Date(r.timestamp).getTime()>3600000;const loc=locations.find(l=>l.aslung_id===r.aslung_id&&l.active)?.lab_id||<span className="text-slate-400">—</span>;return <TableRow key={i}><TableCell><span className={isOffline?"status pending":"status ok"}>{isOffline?"已斷線":"連線中"}</span></TableCell><TableCell>{loc}</TableCell><TableCell className="mono font-medium">{localTime(String(r.timestamp))}</TableCell><TableCell className="mono font-medium">{String(r.aslung_id)}</TableCell><TableCell>{String(r.PM1_G3??"—")}</TableCell><TableCell>{String(r["PM2.5_G3"]??"—")}</TableCell><TableCell>{String(r.PM10_G3??"—")}</TableCell><TableCell>{String(r.temperature??"—")}</TableCell><TableCell>{String(r.rh??"—")}</TableCell><TableCell>{String(r.co2??"—")}</TableCell><TableCell>{String(r.PM1_GSA??"—")}</TableCell><TableCell>{String(r["PM2.5_GSA"]??"—")}</TableCell><TableCell>{String(r.PM10_GSA??"—")}</TableCell></TableRow>})}</TableBody></Table></div>})()}</section></>}
 {section==="data"&&<><section className="panel query-panel"><div className="panel-title"><span><Search size={18}/> 查詢條件</span><small>時間以所選時區 ({tz}) 計算</small></div><form onSubmit={e=>{e.preventDefault();try{void query(parameters()).catch(()=>{})}catch(e){toast.error((e as Error).message)}}} className="query-form"><div><Label>ASLUNG ID</Label>{pick(id,setId,devices.map(d=>({value:d.id,label:d.id+(d.description?" · "+d.description:d.name?" · "+d.name:"")})),"選擇授權設備")}</div><div><Label htmlFor="start">開始時間</Label><Input id="start" type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></div><div><Label htmlFor="end">結束時間</Label><Input id="end" type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></div><Button disabled={busy||!id} type="submit" className="h-11"><Search size={16}/>{busy?"處理中…":"查詢資料"}</Button></form>{chosen?.start&&<p className="permission-note"><ShieldCheck size={14}/> 授權資料期間：{localTime(chosen.start)} ～ {chosen.end ? localTime(chosen.end) : localTime(new Date().toISOString())}</p>}</section>
 <section className="panel results"><div className="results-heading"><div><h2>量測資料 <span>{page?.data.length??0} 筆／本頁</span></h2><p>{queried?queried.id+" · "+localTime(queried.start)+" ～ "+localTime(queried.end):"查詢後顯示所選期間的量測紀錄"}</p></div><div className="flex gap-2"><Button variant="outline" disabled={busy||!page||!queried} onClick={()=>void download("csv")}><Download size={15}/>CSV</Button><Button variant="outline" disabled={busy||!page||!queried} onClick={()=>void download("json")}><FileJson size={15}/>JSON</Button></div></div>
 <Tabs defaultValue="table"><TabsList variant="line" className="mx-6"><TabsTrigger value="table">資料表</TabsTrigger><TabsTrigger value="json">JSON 預覽</TabsTrigger></TabsList><TabsContent value="table">{!page?<Blank title={devices.length?"尚未查詢資料":"尚無可存取設備"} description={devices.length?"選擇 ASLUNG ID 與期間，按下「查詢資料」。":admin?"先在 ASLUNG ID 管理建立設備，再設定資料來源。":"請聯絡管理員指派 ASLUNG ID 與資料期間。"} icon={Search}/>:page.data.length===0?<Blank title="此期間沒有量測資料" description="請調整日期範圍後重新查詢。"/>:<div className="table-scroll"><Table><TableHeader><TableRow>{columns.map(k=><TableHead key={k}>{k}</TableHead>)}</TableRow></TableHeader><TableBody>{page.data.map((r,i)=><TableRow key={i}>{columns.map(k=><TableCell key={k} className={k==="timestamp"?"mono":""}>{k==="timestamp"?localTime(String(r[k])):typeof r[k]==="object"?JSON.stringify(r[k]):String(r[k]??"—")}</TableCell>)}</TableRow>)}</TableBody></Table></div>}</TabsContent><TabsContent value="json"><pre className="json-box">{page?JSON.stringify({aslung_id:queried?.id,start:queried?.start,end:queried?.end,...page},null,2):"// 查詢完成後，將在此顯示實際 JSON 資料。"}</pre></TabsContent></Tabs>{page?.has_more&&queried&&<div className="table-footer"><span>尚有更多資料；下載會自動合併所有分頁。</span><Button variant="outline" disabled={busy} onClick={()=>void query(queried,page.next_cursor!).catch(()=>{})}>下一頁</Button></div>}</section>
 <div className="source-note"><Server size={18}/><div><strong>{state.connected?"EC2 MySQL 資料庫已連線":"AWS EC2 尚未串接"}</strong><p>{state.connected?"查詢結果直接來自既有資料來源；連線是否正常將於查詢時確認。":"會員、設備與授權可以先行設定。完成 API 串接後，即可查詢與下載實際資料。"}</p></div><Button variant="ghost" onClick={()=>setSection("connection")}>查看串接方式</Button></div></>}
 {section==="devices"&&admin&&<section className="panel"><div className="list-heading"><Input className="max-w-sm" placeholder="搜尋 ID、位置或備註" aria-label="搜尋設備" value={search} onChange={e=>setSearch(e.target.value)}/><div className="flex gap-2"><input id="csv-upload" type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} /><Button variant="outline" onClick={()=>setModal("importCsv")}><Upload size={16} className="mr-1"/>大量匯入 CSV</Button><Button onClick={()=>{setEditDevice(null); setModal("device")}}><Plus size={16}/>建立 ASLUNG ID</Button></div></div>{!filtered.length?<Blank title={search?"沒有符合的設備":"建立第一個 ASLUNG ID"} description={search?"請嘗試其他關鍵字。":"建立設備 ID，並為會員指定資料權限。"}/>:<Table><TableHeader><TableRow><TableHead>ASLUNG ID</TableHead><TableHead>目前位置</TableHead><TableHead>備註</TableHead><TableHead>授權會員</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{filtered.map(d=><TableRow key={d.id}><TableCell className="mono font-semibold">{d.id}</TableCell><TableCell>{locations.find(l=>l.aslung_id===d.id&&l.active)?.lab_id||<span className="text-slate-400">無</span>}</TableCell><TableCell className="text-slate-500">{d.description||"—"}</TableCell><TableCell>{grants.filter(g=>g.device_id===d.id).length} 位</TableCell><TableCell><div className="flex gap-2"><Button variant="ghost" size="icon-xs" title="編輯" onClick={()=>{setEditDevice(d); setModal("device")}}><Pencil size={15}/></Button><Button variant="outline" size="sm" onClick={()=>{setTransferDevice(d);setModal("transfer")}}><ArrowRightLeft size={14} className="mr-1"/>移轉位置</Button><Button variant="outline" size="sm" onClick={()=>{setGrantDevice(d.id);setModal("grant")}}><ShieldCheck size={14} className="mr-1"/>設定授權</Button><Button variant="ghost" size="icon-xs" title="刪除" className="text-red-500 hover:text-red-600 hover:bg-red-50 ml-1" onClick={()=>setConfirmation({action:"deviceDelete",id:d.id,title:"刪除此設備？",description:"將一併刪除此設備所有的「資料授權紀錄」與「位置追蹤紀錄」，且無法復原。確認刪除？"})}><Trash2 size={15}/></Button></div></TableCell></TableRow>)}</TableBody></Table>}</section>}
 {section==="members"&&admin&&<section className="panel"><div className="list-heading"><h2>會員帳號 <span className="count">{members.length}</span></h2><Button onClick={()=>{setEditMember(null);setModal("member")}}><Plus size={16}/>新增會員</Button></div><Table><TableHeader><TableRow><TableHead>會員</TableHead><TableHead>帳號 (暱稱)</TableHead><TableHead>Email</TableHead><TableHead>角色</TableHead><TableHead>狀態</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{members.map(m=><TableRow key={m.email}><TableCell className="font-semibold">{m.name}</TableCell><TableCell className="font-medium">{m.nickname || <span className="text-slate-400">-</span>}</TableCell><TableCell>{m.email.endsWith("@local.aslung")?<span className="text-slate-400">無</span>:m.email}</TableCell><TableCell>{m.role==="admin"?"管理員":"會員"}</TableCell><TableCell><span className={m.active?"status ok":"status pending"}>{m.active?"已開通":"已停用"}</span></TableCell><TableCell><div className="flex gap-2"><Button variant="ghost" size="icon-xs" title="編輯" onClick={()=>{setEditMember(m); setModal("member")}}><Pencil size={15}/></Button>{m.email !== state?.me.email && <Button variant="outline" size="sm" onClick={()=>setConfirmation({action:"memberRole",email:m.email,role:m.role==="admin"?"member":"admin",title:m.role==="admin"?"降為一般會員？":"升級為管理員？",description:m.role==="admin"?"此帳號將無法再管理系統。":"此帳號將能管理系統設定與其他帳號。"})}>{m.role==="admin"?"降為會員":"設為管理員"}</Button>}{m.role==="member"&&<Button variant="outline" size="sm" onClick={()=>setConfirmation({action:"memberStatus",email:m.email,active:!m.active,title:m.active?"停用會員？":"恢復會員？",description:m.active?"此會員將無法查詢或下載資料，既有授權仍保留。":"此會員可重新使用已指派的設備授權。"})}>{m.active?"停用":"恢復"}</Button>}</div></TableCell></TableRow>)}</TableBody></Table><p className="panel-footnote">管理員建立帳號後，請自行將帳號暱稱與初始密碼交給會員；此操作不會寄送邀請信。會員可於登入後變更密碼。</p></section>}
 {section==="locations"&&admin&&<section className="panel"><div className="list-heading"><h2>設備位置追蹤 <span className="count">{locations.length}</span></h2><Button onClick={()=>{setModal("location")}}><Plus size={16}/>新增位置紀錄</Button></div>{!locations.length?<Blank title="尚無位置追蹤紀錄" description="新增第一筆設備擺放位置。" icon={MapPin}/>:<Table><TableHeader><TableRow><TableHead>Lab ID (地點)</TableHead><TableHead>ASLUNG ID</TableHead><TableHead>開始時間</TableHead><TableHead>結束時間</TableHead><TableHead>狀態</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{locations.map(l=><TableRow key={l.id}><TableCell className="font-semibold">{l.lab_id}</TableCell><TableCell className="mono">{l.aslung_id}</TableCell><TableCell>{localTime(l.start_time)}</TableCell><TableCell>{l.end_time?localTime(l.end_time):"—"}</TableCell><TableCell><span className={l.active?"status ok":"status pending"}>{l.active?"使用中":"已移出"}</span></TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>{setConfirmation({action:"locationDelete",id:l.id,title:"刪除此紀錄？",description:"確認後將無法復原。"})}}>刪除</Button></div></TableCell></TableRow>)}</TableBody></Table>}</section>}
 {section==="permissions"&&admin&&<section className="panel"><div className="list-heading"><h2>設備資料授權 <span className="count">{grants.length}</span></h2><Button disabled={!devices.length||!members.some(m=>m.role==="member"&&m.active)} onClick={()=>{setGrantDevice("");setGrantEmail("");setGrantId(null);setModal("grant")}}><Plus size={16}/>新增授權</Button></div>{!grants.length?<Blank title="尚未指派資料權限" description="先建立 ASLUNG ID 與會員，再指定可查詢的資料期間。" icon={ShieldCheck}/>:<Table><TableHeader><TableRow><TableHead>ASLUNG ID</TableHead><TableHead>會員</TableHead><TableHead>可存取資料期間（UTC+8）</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{grants.map(g=><TableRow key={g.id}><TableCell className="mono">{g.device_id}</TableCell><TableCell>{members.find(m=>m.email===g.email)?.name}<p className="cell-note">{members.find(m=>m.email===g.email)?.nickname||(g.email.endsWith("@local.aslung")?"":g.email)}</p></TableCell><TableCell>{localTime(g.start)}<br/>{g.end ? localTime(g.end) : "無限制"}</TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>{setGrantDevice(g.device_id);setGrantEmail(g.email);setGrantId(g.id);setModal("grant")}}>編輯</Button><Button size="sm" variant="ghost" aria-label="撤銷授權" onClick={()=>setConfirmation({action:"revoke",id:g.id,title:"刪除此筆授權紀錄？",description:"確認後該會員將失去此紀錄區間的存取權限。"})}><Trash2 size={15}/></Button></div></TableCell></TableRow>)}</TableBody></Table>}</section>}
 {section==="connection"&&<div className="connection-grid">{admin&&<section className="panel p-7"><div className="section-icon"><Server/></div><h2>MySQL 資料庫直連狀態</h2><p className="text-muted-foreground mt-2">本系統已設定為直接連線至 EC2 的 rcec_lung 資料庫。</p><div className="connection-state"><CheckCircle2 size={20} style={{color:"#10b981"}}/><div><strong>已成功設定直連</strong><p>系統直接對 rawdata 表格進行高效能分頁查詢。</p></div></div><h3 className="mt-6 mb-3 font-semibold text-sm">目前的對應設定</h3><ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground"><li>主機：35.160.61.178</li><li>資料表：rcec_lung.rawdata</li><li>時間基準：以 UTC+0 讀取並轉換</li><li>權限控制：強制套用本系統的會員授權區間</li></ul></section>}<section className="panel p-7"><div className="section-icon"><Code2/></div><h2>內部 JSON API 規格</h2><p className="text-muted-foreground mt-2">前端介面與資料下載所使用的內部 API。</p><div className="api-path mono">GET /api/data</div><Table><TableHeader><TableRow><TableHead>參數</TableHead><TableHead>用途</TableHead></TableRow></TableHeader><TableBody>{[["aslung_id","設備識別碼"],["start / end","含時區的 ISO 8601 時間"],["cursor","下一頁游標（選填）"],["download=1","下載完整期間"],["format=json / csv","下載格式"]].map(([a,b])=><TableRow key={a}><TableCell className="mono">{a}</TableCell><TableCell>{b}</TableCell></TableRow>)}</TableBody></Table><p className="panel-footnote mt-4">💡 <strong>自動化串接注意：</strong>API 依賴「瀏覽器 Cookie」或「API Token」。下方可產生您專屬的 Token 來供外部程式使用。</p></section><section className="panel p-7"><div className="section-icon"><Key/></div><div className="flex items-center justify-between"><div><h2>我的 API 存取權杖</h2><p className="text-muted-foreground mt-2">在您的外部程式 HTTP Request 標頭加入 `Authorization: Bearer &lt;TOKEN&gt;` 即可認證身分並下載資料。</p></div><Button onClick={()=>setConfirmation({action:"tokenCreate",title:"產生新權杖？",description:"將產生一組隨機的新權杖供您的應用程式使用。"})}>產生權杖</Button></div><div className="mt-6"><Table><TableHeader><TableRow><TableHead>Token 字串</TableHead><TableHead>建立時間</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{tokens.map(t=><TableRow key={t.id}><TableCell className="mono font-semibold">{t.id}</TableCell><TableCell>{localTime(t.created_at)}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={()=>setConfirmation({action:"tokenDelete",id:t.id,title:"刪除此權杖？",description:"所有正在使用此權杖的程式將立即無法連線。確認？"})}><Trash2 size={15}/></Button></TableCell></TableRow>)}{!tokens.length&&<TableRow><TableCell colSpan={3} className="text-center text-muted-foreground h-20">尚未產生任何 API 權杖</TableCell></TableRow>}</TableBody></Table></div></section></div>}
 </>}
 <footer className="workspace-footer"><span>ASLUNG · 資料管理平台</span><span><ShieldCheck size={13}/> 伺服器端權限驗證</span></footer></div></main>
 <Dialog open={!!modal} onOpenChange={v=>{if(!busy&&!v)setModal("")}}>
  <DialogContent className="bg-white sm:max-w-lg">
    <DialogHeader>
      <DialogTitle>
        {modal==="device" ? (editDevice?"編輯 ASLUNG ID":"建立 ASLUNG ID")
        : modal==="transfer" ? "移轉設備位置"
        : modal==="importCsv" ? "大量匯入 CSV"
        : modal==="member" ? (editMember ? "編輯會員" : "新增會員")
        : modal==="location" ? "新增位置紀錄"
        : modal==="password" ? "變更密碼"
        : grantId ? "編輯資料授權紀錄" : "新增資料授權紀錄"}
      </DialogTitle>
      <DialogDescription>
        {modal==="device" ? "ID 應與 EC2 資料來源的設備識別碼一致。"
        : modal==="member" ? (editMember ? "修改會員的基本資料與登入密碼。" : "設定會員帳號與初始密碼；會員登入後可變更密碼。")
        : modal==="location" ? "記錄設備（包含國外站點）目前的擺放位置與期間。"
        : modal==="importCsv" ? "請參考下方的資料格式說明後上傳檔案或貼上資料。"
        : modal==="password" ? "變更後將登出所有裝置，請使用新密碼重新登入。"
        : "指定會員可存取的設備與資料期間；相同會員與設備會更新原有授權。"}
      </DialogDescription>
    </DialogHeader>
    <form key={modal+grantDevice+grantEmail} className="modal-form" onSubmit={e=>{
      e.preventDefault();
      const f=new FormData(e.currentTarget);
      const p=Object.fromEntries(f);
      try{
        if(modal==="password"){
          setBusy(true);
          void request("/api/auth/password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}).then(()=>window.location.assign("/login")).catch(e=>toast.error(e.message)).finally(()=>setBusy(false));
        }else if(modal==="grant"){
          void mutate({action:"grant",id:grantId,deviceId:grantDevice,email:grantEmail,start:zoned(String(p.start)),end:p.end?zoned(String(p.end)):null});
        }else if(modal==="location"){
          void mutate({action:"locationAdd",...p,startTime:zoned(String(p.startTime)),endTime:p.endTime?zoned(String(p.endTime)):null});
        }else if(modal==="importCsv"){
          const text=String(p.csvText||"").trim();
          if(!text)throw new Error("請貼上資料");
          void parseAndImportCsv(text);
        }else if (modal==="transfer"){
          void (async()=>{
            if(await mutate({action:"transfer",...p})){
              if(confirm("移轉成功！\n\n是否結束該設備先前的資料授權？\n(若點選「確定」，原授權將結算至現在，並會引導您設定新授權。若點選「取消」則繼續沿用原授權)")){
                if(await mutate({action:"endGrants",aslungId:String(p.aslungId)})){
                  setGrantDevice(String(p.aslungId));setGrantEmail("");setGrantId(null);setModal("grant");
                }
              }
            }
          })();
        } else if (modal === "member" && editMember) {
          void mutate({action:"memberEdit", ...p});
        } else {
          void mutate({action:modal,...p});
        }
      }catch(e){
        toast.error((e as Error).message);
      }
    }}>
      {modal==="device"?<>
        <Label htmlFor="device-id">ASLUNG ID</Label>
        <Input id="device-id" name="id" required maxLength={80} placeholder="例如 ASLUNG_001" pattern="[A-Za-z0-9_-]+" defaultValue={editDevice?.id||""} readOnly={!!editDevice}/>
        <Label htmlFor="lab-id-device">目前位置 / 實驗室</Label>
        <Input id="lab-id-device" name="labId" maxLength={160} placeholder="例如：國外實驗室 A" defaultValue={editDevice ? (locations.find(l=>l.aslung_id===editDevice.id&&l.active)?.lab_id || "") : ""}/>
        <Label htmlFor="description">備註</Label>
        <Textarea id="description" name="description" maxLength={1000} placeholder="選填" defaultValue={editDevice?.description||""}/>
      </> : modal==="transfer"?<>
        <div className="mb-4 text-sm text-slate-600">設備 <strong className="mono">{transferDevice?.id}</strong> 將移轉至新位置，系統會自動結算當前位置的紀錄並建立新紀錄。</div>
        <input type="hidden" name="aslungId" value={transferDevice?.id||""} />
        <Label htmlFor="lab-id">新位置 / 實驗室名稱</Label>
        <Input id="lab-id" name="labId" required maxLength={160} placeholder="例如：國外實驗室 A" />
      </> : modal==="member"?<>
        {editMember && <input type="hidden" name="originalEmail" value={editMember.email} />}
        <Label htmlFor="member-name">會員姓名</Label>
        <Input id="member-name" name="name" required maxLength={160} defaultValue={editMember?.name||""}/>
        <Label htmlFor="member-nickname">會員帳號 (暱稱)</Label>
        <Input id="member-nickname" name="nickname" required maxLength={80} placeholder="例如：user123" pattern="[A-Za-z0-9_\\-]+" defaultValue={editMember?.nickname||""}/>
        <Label htmlFor="email">Email (選填)</Label>
        <Input id="email" name="email" type="email" maxLength={254} defaultValue={editMember?.email?.endsWith("@local.aslung") ? "" : editMember?.email||""}/>
        <Label htmlFor="initial-password">{editMember ? "新密碼 (若不修改請留空，至少 12 字元)" : "初始密碼（至少 12 字元）"}</Label>
        <Input id="initial-password" name="password" type="password" autoComplete="new-password" required={!editMember} minLength={12} maxLength={128}/>
      </> : modal==="password"?<>
        <Label htmlFor="current-password">目前密碼</Label>
        <Input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/>
        <Label htmlFor="new-password">新密碼（至少 12 字元）</Label>
        <Input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/>
      </> : modal==="importCsv"?<>
        <p className="text-slate-600 mb-2">請在下方直接 <strong>貼上資料</strong>，或點選下方按鈕從 <strong>.csv / .txt</strong> 檔案上傳。</p>
        <div className="bg-blue-50/50 p-3 rounded-md border border-blue-100 mb-4">
          <ul className="list-disc pl-5 space-y-1 text-blue-800 text-xs">
            <li>每行一筆，格式：<strong>ASLUNG ID, 目前位置</strong>（位置為選填）。</li>
            <li>系統會自動忽略標題列與多餘的引號，僅限英數、底線、連字號。</li>
          </ul>
        </div>
        <Textarea id="csv-paste" name="csvText" rows={8} className="font-mono text-sm" placeholder={`範例：\nAL-0805, 泰國實驗室\nAL-0806, 蒙古\nAL-0886`} />
      </> : modal==="location"?<>
        <Label htmlFor="lab-id">Lab ID / 擺放地點</Label>
        <Input id="lab-id" name="labId" required maxLength={160} placeholder="例如 國外實驗室 A"/>
        <Label htmlFor="aslung-id-sel">ASLUNG ID</Label>
        <select id="aslung-id-sel" name="aslungId" className="w-full h-11 border px-3 rounded-md bg-white" required><option value="">選擇設備</option>{devices.map(d=><option key={d.id} value={d.id}>{d.id} · {d.name}</option>)}</select>
        <Label htmlFor="loc-start">開始時間 ({tz})</Label>
        <Input id="loc-start" name="startTime" type="datetime-local" defaultValue={today()+"T00:00"} required/>
        <Label htmlFor="loc-end">結束時間 ({tz})</Label>
        <Input id="loc-end" name="endTime" type="datetime-local" />
        <Label className="flex items-center gap-2 mt-4"><input type="checkbox" name="active" value="1" defaultChecked /> 目前在此位置 (Active)</Label>
      </> : <>
        <Label>ASLUNG ID</Label>
        {pick(grantDevice,setGrantDevice,devices.map(d=>({value:d.id,label:d.id+(d.description?" · "+d.description:d.name?" · "+d.name:"")})),"選擇設備")}
        <Label>會員</Label>
        {pick(grantEmail,setGrantEmail,members.filter(m=>m.role==="member"&&m.active).map(m=>({value:m.email,label:m.name+" · "+(m.nickname||(m.email.endsWith("@local.aslung")?"無":m.email))})),"選擇會員")}
        <Label htmlFor="grant-start">可存取資料開始時間 ({tz})</Label>
        <Input id="grant-start" name="start" type="datetime-local" defaultValue={(()=>{const g=grants.find(g=>g.id===grantId);return g?formatInTimeZone(new Date(g.start), tz, "yyyy-MM-dd'T'HH:mm"):today()+"T00:00"})()} required/>
        <Label htmlFor="grant-end">可存取資料結束時間 ({tz})</Label>
        <Input id="grant-end" name="end" type="datetime-local" defaultValue={(()=>{const g=grants.find(g=>g.id===grantId);return (g&&g.end)?formatInTimeZone(new Date(g.end), tz, "yyyy-MM-dd'T'HH:mm"):""})()} />
      </>}
      <div className="modal-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={()=>setModal("")}>取消</Button>
        {modal==="importCsv"?<div className="flex gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={()=>{document.getElementById("csv-upload")?.click();}}><Upload size={14} className="mr-1"/>從檔案上傳</Button>
          <Button disabled={busy} type="submit">{busy?"匯入中…":"匯入貼上資料"}</Button>
        </div>:<Button disabled={busy||(modal==="grant"&&(!grantDevice||!grantEmail))} type="submit">{busy?"儲存中…":"儲存"}</Button>}
      </div>
    </form>
  </DialogContent>
</Dialog>
 <AlertDialog open={!!confirmation} onOpenChange={v=>{if(!busy&&!v)setConfirmation(null)}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation?.title}</AlertDialogTitle><AlertDialogDescription>{confirmation?.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e=>{e.preventDefault();void mutate(confirmation)}}>{busy?"處理中…":"確認"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </SidebarProvider>;
}
