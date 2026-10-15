"use client";
import JSZip from "jszip";
import MemberProfileFields, {type MemberProfile} from "@/components/MemberProfileFields";
import RegistrationReviews from "@/components/RegistrationReviews";
import DeviceMultiSelect from "@/components/DeviceMultiSelect";
import DeviceFleetView from "@/components/DeviceFleetView";
import DeviceImportWizard from "@/components/DeviceImportWizard";
import RealtimeDiscovery from "@/components/RealtimeDiscovery";
import {currentDeploymentMap} from "@/lib/device-deployments.mjs";
import {visibleRealtimeRows,mergeRealtimeRows} from "@/lib/realtime-discovery.mjs";
import {ADMIN_REALTIME_INTERVALS, MEMBER_REALTIME_INTERVALS, normalizeRealtimeInterval} from "@/lib/realtime-settings.mjs";
import {useState,useEffect,useCallback,useRef,useMemo} from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import FontSizeAdjuster from "@/components/FontSizeAdjuster";
import {Activity,Database,Users,ShieldCheck,Download,Plus,RefreshCw,Code2,Server,LockKeyhole,FileJson,LogOut,LogIn,CheckCircle2,Unplug,Search,Trash2, MapPin, Key, RadioTower, Upload, Pencil, Check, ChevronsUpDown, ArrowRightLeft, QrCode, FileSpreadsheet, CloudDownload, FolderDown, FileText, Eye, Building2, UserCheck, BellRing, Mail, Clock, KeyRound, Filter, RotateCcw, X, AlertTriangle} from "lucide-react";
import {Button} from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Tabs,TabsList,TabsTrigger,TabsContent} from "@/components/ui/tabs";
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from "@/components/ui/table";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "@/components/ui/dialog";
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from "@/components/ui/alert-dialog";
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from "@/components/ui/select";
import {SidebarProvider,Sidebar,SidebarHeader,SidebarContent,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarTrigger} from "@/components/ui/sidebar";
import {Empty,EmptyHeader,EmptyTitle,EmptyDescription,EmptyMedia} from "@/components/ui/empty";
import {Skeleton} from "@/components/ui/skeleton";
import {Toaster,toast} from "sonner";
import LabsView, { Lab } from "@/components/LabsView";
import MaintainersView, { Maintainer } from "@/components/MaintainersView";
import AlertsView, { AlertSettings, AlertLog, AlertCheck } from "@/components/AlertsView";
import ApiDocsView from "@/components/ApiDocsView";

type TrackingRange = { start: string; end: string | null; active: boolean };
type Device = {
  id: string;
  name: string;
  location: string;
  description: string;
  status: string;
  invalid_range?: boolean;
  selection_id?: string;
  segment_id?: string;
  deployment_start?: string;
  deployment_end?: string | null;
  start?: string;
  end?: string;
  is_granted?: boolean;
  is_maintained?: boolean;
  grant_source?: string;
  grant_lab_id?: string;
  grant_lab_name?: string;
  tracking_ranges?: TrackingRange[];
  is_active_at_lab?: boolean;
};
type Member=MemberProfile&{email:string;name:string;nickname?:string|null;role:string;active:number;login_count?:number;last_login_at?:string|null};
type Grant={id:number;grant_type?:string;device_id:string|null;lab_id:string|null;email:string;start:string;end:string|null;location_name?:string;city_name?:string;town_name?:string;lab_device_count?:number};
type DeviceLocation={id:number;lab_id:string;aslung_id:string;maintainer?:string|null;start_time:string;end_time:string|null;active:number};
type ApiToken={id:string;created_at:string};
type FileItem={id:string;name:string;size:number;mime_type:string;description?:string|null;uploader_email:string;storage_path:string;download_count?:number;created_at:string}; type FileGrant={id:number;file_id:string;email:string;created_at:string}; type GrantRequest={id:number;email:string;request_type?:string;aslung_id:string;lab_id?:string|null;reason:string;status:string;reviewed_by?:string|null;reviewed_at?:string|null;created_at:string;member_name?:string;member_nickname?:string|null;location_name?:string;city_name?:string;town_name?:string}; type State={me:MemberProfile&{allowMaintainerNameMatch?:boolean;email:string;name:string;role:string;login_count?:number;last_login_at?:string|null};devices:Device[];downloadSegments:Device[];members:Member[];grants:Grant[];locations:DeviceLocation[];tokens:ApiToken[];files:FileItem[];fileGrants:FileGrant[];labs?:Lab[];maintainers?:Maintainer[];alertSettings?:AlertSettings;alertChecks?:AlertCheck[];alertLogs?:AlertLog[];grantRequests?:GrantRequest[];connected:boolean;totalLogins?:number;siteStats?:{totalViews:number;todayViews:number}};
type Page={data:Record<string,unknown>[];next_cursor:string|null;has_more:boolean};
const pick = (value: string, onChange: (s: string) => void, items: {value: string; label: string}[], placeholder: string, compact = false) => {
 const selected = items.find(item => item.value === value);
 const shortLabel = (item: {value: string; label: string}) => item.label;
 return <Select value={value} onValueChange={onChange}>
   <SelectTrigger className={cn("w-full min-w-0 max-w-full h-11 bg-white", compact && "device-select-trigger")} aria-label={compact ? "ASLUNG ID" : undefined} title={selected?.label}>
     <SelectValue key={compact ? value || "placeholder" : undefined} placeholder={placeholder} translate={compact && selected && value !== "__ALL__" ? "no" : undefined}>
       {compact && selected ? <span translate={selected.value === "__ALL__" ? undefined : "no"}>{shortLabel(selected)}</span> : undefined}
     </SelectValue>
   </SelectTrigger>
   <SelectContent position={compact ? "popper" : "item-aligned"} align="start" className={compact ? "device-select-content" : undefined}>
     {items.map(item => <SelectItem key={item.value} value={item.value} textValue={item.label} title={item.label}>
       {compact ? <span className="device-option">
         <span className="device-option-id" translate={item.value === "__ALL__" ? undefined : "no"}>{shortLabel(item)}</span>
       </span> : item.label}
     </SelectItem>)}
   </SelectContent>
 </Select>;
};
function Blank({title,description,icon:Icon=Database}:{title:string;description:string;icon?:typeof Database}){return <Empty className="empty-area"><EmptyHeader><EmptyMedia variant="icon"><Icon/></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription className="text-sm">{description}</EmptyDescription></EmptyHeader></Empty>;}
async function request(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  if (r.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("登入階段已過期，請重新登入。");
  }
  const text = await r.text();
  let p: any = null;
  try {
    p = text ? JSON.parse(text) : {};
  } catch {
    if (!r.ok) throw new Error(`伺服器回應錯誤 (${r.status} ${r.statusText || ""})`.trim());
    throw new Error("伺服器回應格式錯誤");
  }
  if (!r.ok) throw new Error(p.error ?? `操作失敗 (${r.status})，請稍後重試。`);
  return p;
}


function formatFileSize(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

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

const formatRealtimeInterval = (s: number) => {
  if (!s || s <= 0) return "暫停更新";
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m} 分 ${rem} 秒` : `${m} 分鐘`;
};

export default function Workspace({signedIn,signInUrl}:{signedIn:boolean;signInUrl:string}){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(signedIn),[section,setSection]=useState("data"),[modal,setModal]=useState(""),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState<any>(null);
 const [selectedDownloadIds, setSelectedDownloadIds] = useState<string[]>([]);
 const [id,setId]=useState(""),[start,setStart]=useState(""),[end,setEnd]=useState(""),[page,setPage]=useState<Page|null>(null),[queried,setQueried]=useState<{id:string;start:string;end:string;segment_id?:string}|null>(null),[search,setSearch]=useState("");
 const [grantDevice,setGrantDevice]=useState(""),[grantEmail,setGrantEmail]=useState(""),[grantId,setGrantId]=useState<number|null>(null),[grantType,setGrantType]=useState<"device"|"lab">("lab"),[grantLab,setGrantLab]=useState("");
  const [clippingWarning, setClippingWarning] = useState<{
    device: Device;
    original: { start: string; end: string };
    clipped: { start: string; end: string; isoStart?: string; isoEnd?: string };
    actionType: "query" | "download";
    format?: string;
  } | null>(null);

  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchLogs, setBatchLogs] = useState<Array<{
    id: string;
    status: "waiting" | "fetching" | "success" | "skipped" | "error";
    message?: string;
    count?: number;
    validRange?: string;
  }>>([]);
  const [batchBlobUrl, setBatchBlobUrl] = useState<string>("");
  const [batchZipFilename, setBatchZipFilename] = useState<string>("");
  const [tz, setTz] = useState<string>("Asia/Taipei");
  const [tzOpen, setTzOpen] = useState(false);
  const [editDevice, setEditDevice] = useState<any>(null);
  const [editLocation, setEditLocation] = useState<any>(null);
  const [editMember, setEditMember] = useState<any>(null);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [transferDevice, setTransferDevice] = useState<any>(null);
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [qrScanning, setQrScanning] = useState(false);
  const [qrDevice, setQrDevice] = useState<any>(null);
  const [liveQrId, setLiveQrId] = useState<string>("");
  const [liveQrUrl, setLiveQrUrl] = useState<string>("");
  const [viewQrUrl, setViewQrUrl] = useState<string>("");
  const [selectedLocations, setSelectedLocations] = useState<Set<number>>(new Set());
  const [uploadDescription, setUploadDescription] = useState<string>("");
  const [uploadEmails, setUploadEmails] = useState<Set<string>>(new Set());
  const [fileGrantEmails, setFileGrantEmails] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [selectedLabs, setSelectedLabs] = useState<Set<string>>(new Set());
  const [editLab, setEditLab] = useState<Lab | null>(null);
  const [selectedMaintainers, setSelectedMaintainers] = useState<Set<string>>(new Set());
  const [editMaintainer, setEditMaintainer] = useState<Maintainer | null>(null);
  const [selectedAlertLogs, setSelectedAlertLogs] = useState<Set<number>>(new Set());
  const [selectedAlertChecks, setSelectedAlertChecks] = useState<Set<number>>(new Set());
  const [requestType, setRequestType] = useState<"device"|"lab">("lab");
  const [requestAslungId, setRequestAslungId] = useState("");
  const [requestLabId, setRequestLabId] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [reviewRequest, setReviewRequest] = useState<any>(null);
  const [alertScheduleType, setAlertScheduleType] = useState<"interval" | "daily" | "weekly">("interval");
  const [alertScheduleDays, setAlertScheduleDays] = useState<string>("1,2,3,4,5");
  const [fleetImportText, setFleetImportText] = useState("");
  const [isEn, setIsEn] = useState(false);

  useEffect(() => {
    const checkEn = () => {
      const match = typeof document !== "undefined" ? document.cookie.match(/(^|;) ?googtrans=([^;]*)(;|$)/) : null;
      const isEnglish = (match && match[2] && decodeURIComponent(match[2]).endsWith("/en")) ||
        (typeof document !== "undefined" && (document.documentElement.lang === "en" || document.documentElement.classList.contains("translated-ltr")));
      setIsEn(!!isEnglish);
    };
    checkEn();
    const timer = setInterval(checkEn, 1500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (modal && typeof window !== "undefined") {
      try {
        const select = document.querySelector(".goog-te-combo") as HTMLSelectElement | null;
        if (select && select.value) {
          select.dispatchEvent(new Event("change"));
        }
      } catch {}
    }
  }, [modal]);
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const validSections = ["realtime", "data", "devices", "members", "permissions", "locations", "labs", "maintainers", "alerts", "files", "connection"];
    const hash = window.location.hash.replace(/^#/, "");
    const saved = localStorage.getItem("aslung_section");
    const target = (hash && validSections.includes(hash))
      ? hash
      : (saved && validSections.includes(saved))
        ? saved
        : null;

    if (target && target !== "data") {
      setSection(target);
    }
    if (target && !hash) {
      window.history.replaceState(null, "", `#${target}`);
    }

    const onHashChange = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (h && validSections.includes(h)) {
        setSection(h);
        localStorage.setItem("aslung_section", h);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (section && typeof window !== "undefined") {
      localStorage.setItem("aslung_section", section);
      if (window.location.hash !== `#${section}`) {
        window.history.replaceState(null, "", `#${section}`);
      }
    }
  }, [section]);

  useEffect(() => {
    if (state && state.me.role !== "admin") {
      const allowed = ["realtime", "data", ...(isMaintainer ? ["alerts"] : []), "files", "connection"];
      if (!allowed.includes(section)) {
        setSection("data");
      }
    }
  }, [state, section]);

  useEffect(() => { if (typeof window !== "undefined") { const sp = new URLSearchParams(window.location.search); const urlId = sp.get("id") || sp.get("device") || sp.get("aslung_id"); if (urlId) { setId(urlId); setSearch(urlId); } } }, []);

  const today = useCallback(() => {
    try { return formatInTimeZone(new Date(), tz, "yyyy-MM-dd"); } catch { return "2024-01-01"; }
  }, [tz]);

  const localTime = useCallback((s: string) => {
    try { return formatInTimeZone(new Date(s), tz, "yyyy/MM/dd HH:mm:ss"); } catch { return s; }
  }, [tz]);

  const zoned = useCallback((s: string) => {
    try { return fromZonedTime(s, tz).toISOString(); } catch { return new Date(s).toISOString(); }
  }, [tz]);

  const generateQrLabel = useCallback(async (id: string): Promise<string> => {
    if (!id) return "";
    try {
      const QRCodeMod = await import("qrcode");
      const QRCode = QRCodeMod.default || QRCodeMod;
      const origin = typeof window !== "undefined" && window.location.origin ? window.location.origin : "https://aslung.tw"; const deviceUrl = origin + "/?id=" + encodeURIComponent(id); const qrDataUrl = await QRCode.toDataURL(deviceUrl, {
        width: 240,
        margin: 1,
        color: { dark: "#0f172a", light: "#ffffff" }
      });
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 280;
          canvas.height = 360;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(qrDataUrl);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = "#cbd5e1";
          ctx.lineWidth = 2;
          ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
          ctx.fillStyle = "#0f766e";
          ctx.font = "bold 14px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("ASLUNG 監測設備", canvas.width / 2, 28);
          ctx.drawImage(img, 20, 36, 240, 240);
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(12, 280, canvas.width - 24, 66);
          ctx.strokeStyle = "#cbd5e1";
          ctx.strokeRect(12, 280, canvas.width - 24, 66);
          ctx.fillStyle = "#0f172a";
          ctx.font = "bold 15px monospace";
          ctx.textAlign = "center";
          ctx.fillText(id, canvas.width / 2, 305); ctx.fillStyle = "#0284c7"; ctx.font = "10px monospace"; const displayUrl = deviceUrl.replace(/^https?:\/\//, ""); ctx.fillText(displayUrl.length > 36 ? displayUrl.slice(0, 34) + "..." : displayUrl, canvas.width / 2, 330);
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => resolve(qrDataUrl);
        img.src = qrDataUrl;
      });
    } catch {
      return "";
    }
  }, []);

  const printQrLabel = useCallback((dataUrl: string, id?: string) => {
    if (!dataUrl) return;
    const w = window.open("", "_blank", "width=450,height=550");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>ASLUNG ID: ${id||""} QR Code</title><style>body{margin:0;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;}img{max-width:100%;height:auto;}@media print{body{padding:0;min-height:auto;}}</style></head><body><img src="${dataUrl}" onload="window.print();setTimeout(()=>window.close(),500);"/></body></html>`);
    w.document.close();
  }, []);

  useEffect(() => {
    if (modal === "device") {
      const idToUse = liveQrId || editDevice?.id || "";
      if (idToUse) {
        generateQrLabel(idToUse).then(setLiveQrUrl);
      } else {
        setLiveQrUrl("");
      }
    }
  }, [modal, editDevice, liveQrId, generateQrLabel]);

  useEffect(() => {
    if (modal === "deviceQr" && qrDevice) {
      generateQrLabel(qrDevice.id).then(setViewQrUrl);
    } else {
      setViewQrUrl("");
    }
  }, [modal, qrDevice, generateQrLabel]);

 const [realtimeData, setRealtimeData] = useState<any[]|null>(null);
 const [discoveredRealtime, setDiscoveredRealtime] = useState<any[]>([]);
 const discoveredDeviceIds = useRef<string[]>([]);
 const [realtimeSearch, setRealtimeSearch] = useState("");
 const [realtimeLoading, setRealtimeLoading] = useState(false);
 const [realtimeRefreshedAt, setRealtimeRefreshedAt] = useState<Date|null>(null);
 const [realtimeInterval, setRealtimeInterval] = useState<number>(60);
 const admin=state?.me.role==="admin",devices=state?.devices??[],members=state?.members??[],grants=state?.grants??[],locations=state?.locations??[],tokens=state?.tokens??[],files=state?.files??[],fileGrants=state?.fileGrants??[],labs=state?.labs??[],maintainers=state?.maintainers??[],alertSettings=state?.alertSettings,alertChecks=state?.alertChecks??[],alertLogs=state?.alertLogs??[],grantRequests=state?.grantRequests??[];
 const currentDeployments = useMemo<Map<string,DeviceLocation>>(()=>currentDeploymentMap(locations),[locations,realtimeRefreshedAt]);
 const combinedRealtime = useMemo<any[]>(()=>mergeRealtimeRows(realtimeData||[],admin?discoveredRealtime:[]),[realtimeData,discoveredRealtime,admin]);
 const visibleRealtime = useMemo<any[]>(()=>visibleRealtimeRows(combinedRealtime,devices,locations),[combinedRealtime,devices,locations]);
 const downloadDevices = useMemo(() => state?.downloadSegments ?? [], [state?.downloadSegments]);
 useEffect(() => {
   if (!id || id.startsWith("__") || downloadDevices.some(d => d.selection_id === id)) return;
   const segment = downloadDevices.find(d => d.id === id);
   if (segment?.selection_id) setId(segment.selection_id);
 }, [id, downloadDevices]);
 const batchSelection = id === "__ALL__" || id === "__MULTI__";
 const selectedDeviceIds = id === "__ALL__" ? downloadDevices.filter(device=>!device.invalid_range).map(device => device.selection_id!)
   : id === "__MULTI__" ? selectedDownloadIds : id ? [id] : [];
 const deviceDownloadOptions = downloadDevices.map(device => ({
   value: device.selection_id!,
   deviceId: device.id,
   disabled: device.invalid_range,
   description: `${localTime(device.deployment_start || device.start || "")} ～ ${device.deployment_end ? localTime(device.deployment_end) : (isEn ? "Present" : "至今")}`,
   label: (device.invalid_range ? (isEn ? "[Invalid dates] " : "【日期異常】") : "") + ((device.grant_lab_id || device.location) ? `${device.grant_lab_id || device.location}：${device.id}` : device.id)
     + ((device.is_active_at_lab ?? (device.status === "DEPLOYED")) ? (isEn ? " (Operating)" : "（運作中）") : "")
 }));
 function selectDownloadDevices(values: string[]) {
   setSelectedDownloadIds(values);
   setId(values.length === 0 ? "" : values.length === 1 ? values[0]
     : values.length === downloadDevices.filter(d=>!d.invalid_range).length ? "__ALL__" : "__MULTI__");
 }
  const isMaintainer = useMemo(() => {
    if (!state?.me) return false;
    if (state.me.role === "admin") return true;
    const myName = state.me.allowMaintainerNameMatch ? (state.me.name || "").trim() : "";
    const myNickname = state.me.allowMaintainerNameMatch ? ((state.me as any)?.nickname || "").trim() : "";
    const myEmail = (state.me.email || "").trim().toLowerCase();
    const inMaintainers = (state.maintainers || []).some(m => (m.name && (m.name.trim() === myName || (myNickname && m.name.trim() === myNickname))) || (m.email && m.email.trim().toLowerCase() === myEmail));
    const inLocations = (state.locations || []).some(l => l.maintainer && (l.maintainer.trim() === myName || (myNickname && l.maintainer.trim() === myNickname)));
    return inMaintainers || inLocations;
  }, [state]);
 useEffect(() => {
   if (!state?.me.email) return;
   const defaultInterval = normalizeRealtimeInterval(alertSettings?.realtime_interval_secs ?? 60, admin);
   if (!admin) {
     try {
       const saved = localStorage.getItem(`aslung_realtime_interval:${state.me.email.toLowerCase()}`);
       if (saved !== null) {
         const interval = normalizeRealtimeInterval(saved, false);
         setRealtimeInterval(interval);
         if (String(interval) !== saved) localStorage.setItem(`aslung_realtime_interval:${state.me.email.toLowerCase()}`, String(interval));
         return;
       }
     } catch {}
   }
   setRealtimeInterval(defaultInterval);
 }, [state?.me.email, admin, alertSettings?.realtime_interval_secs]);
 async function updateRealtimeInterval(newSecs: number) {
   newSecs = normalizeRealtimeInterval(newSecs, admin);
   const previousInterval = realtimeInterval;
   setRealtimeInterval(newSecs);
   if (admin) {
     const saved = await mutate({action: "realtimeIntervalUpdate", interval: newSecs});
     if (!saved) setRealtimeInterval(previousInterval);
   } else if (state?.me.email) {
     try {
       localStorage.setItem(`aslung_realtime_interval:${state.me.email.toLowerCase()}`, String(newSecs));
       toast.success(newSecs === 0 ? "已暫停此帳號在本瀏覽器的自動更新" : `此帳號的更新頻率已設為每 ${formatRealtimeInterval(newSecs)}`);
     } catch {
       toast.error("更新頻率已套用，但無法記住設定；重新整理後會恢復預設值。");
     }
   }
 }
 const fetchRealtime=useCallback(async(isManual=false)=>{setRealtimeLoading(true);try{const extras=discoveredDeviceIds.current;const data=await request("/api/realtime"+(extras.length?"?extra_ids="+encodeURIComponent(extras.join(",")):""));setRealtimeData(data);setRealtimeRefreshedAt(new Date());if(isManual)toast.success("已更新即時狀態");}catch(e){if(isManual)toast.error((e as Error).message);}finally{setRealtimeLoading(false);}},[]);
 useEffect(()=>{if(section==="realtime"||section==="alerts"||section==="devices"){void fetchRealtime(false);if(realtimeInterval>0&&section==="realtime"){const timer=setInterval(()=>void fetchRealtime(false),realtimeInterval*1000);return()=>clearInterval(timer);}}},[section,realtimeInterval,fetchRealtime]);
 useEffect(() => {
   if (alertSettings) {
     if (alertSettings.schedule_type) setAlertScheduleType(alertSettings.schedule_type);
     if (alertSettings.schedule_days) setAlertScheduleDays(alertSettings.schedule_days);
   }
 }, [alertSettings?.schedule_type, alertSettings?.schedule_days]);
  // admin loaded
 const load=useCallback(async()=>{setLoading(true);try{const s=await request("/api/manage");setState(s);setError("");void fetchRealtime(false);}catch(e){setError((e as Error).message);}finally{setLoading(false)}},[fetchRealtime]);
 useEffect(()=>{if(signedIn)void load()},[signedIn,load]);
 useEffect(()=>{setPage(null);setQueried(null)},[id,start,end]);

  useEffect(() => {
    if (!id || id === "__ALL__" || id === "__MULTI__") return;
    const dev = downloadDevices.find(d => d.selection_id === id);
    if (!dev) return;

    if (dev.tracking_ranges && dev.tracking_ranges.length > 0) {
      const latest = {start: dev.tracking_ranges[0].start, end: dev.tracking_ranges.at(-1)?.end};
      const localStart = formatInTimeZone(new Date(latest.start), tz, "yyyy-MM-dd'T'HH:mm");
      let localEnd = "";
      if (latest.end) {
        localEnd = formatInTimeZone(new Date(latest.end), tz, "yyyy-MM-dd'T'HH:mm");
      } else {
        localEnd = formatInTimeZone(new Date(), tz, "yyyy-MM-dd'T'HH:mm");
      }
      setStart(localStart);
      setEnd(localEnd);
    } else if (dev.start) {
      const localStart = formatInTimeZone(new Date(dev.start), tz, "yyyy-MM-dd'T'HH:mm");
      const localEnd = dev.end ? formatInTimeZone(new Date(dev.end), tz, "yyyy-MM-dd'T'HH:mm") : formatInTimeZone(new Date(), tz, "yyyy-MM-dd'T'HH:mm");
      setStart(localStart);
      setEnd(localEnd);
    }
  }, [id, downloadDevices, tz]);
  async function mutate(p:any){setBusy(true);try{const result=await request("/api/manage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});if(result.notice)toast.warning(result.notice);await load();setModal("");setConfirmation(null);if(p?.action==="deviceDeleteBulk")setSelectedDevices(new Set());if(p?.action==="deviceDelete")setSelectedDevices(prev=>{const s=new Set(prev);s.delete(p.id);return s;});if(p?.action==="locationDeleteBulk")setSelectedLocations(new Set());if(p?.action==="locationDelete")setSelectedLocations(prev=>{const s=new Set(prev);s.delete(Number(p.id));return s;});if(p?.action==="labDeleteBulk")setSelectedLabs(new Set());if(p?.action==="labDelete")setSelectedLabs(prev=>{const s=new Set(prev);s.delete(p.id);return s;});if(p?.action==="maintainerDeleteBulk")setSelectedMaintainers(new Set());if(p?.action==="maintainerDelete")setSelectedMaintainers(prev=>{const s=new Set(prev);s.delete(p.name);return s;});if(p?.action==="alertLogDeleteBulk"||p?.action==="alertLogClearAll")setSelectedAlertLogs(new Set());if(p?.action==="alertLogDelete")setSelectedAlertLogs(prev=>{const s=new Set(prev);s.delete(Number(p.id));return s;});if(p?.action==="alertCheckDeleteBulk"||p?.action==="alertCheckClearAll")setSelectedAlertChecks(new Set());if(p?.action==="alertCheckDelete")setSelectedAlertChecks(prev=>{const s=new Set(prev);s.delete(Number(p.id));return s;});if(p?.action==="memberDeleteBulk")setSelectedMembers(new Set());if(p?.action==="memberDelete")setSelectedMembers(prev=>{const s=new Set(prev);s.delete(p.email);return s;});toast.success("已儲存變更");return true;}catch(e){toast.error((e as Error).message);return false;}finally{setBusy(false)}}
 async function query(params:{id:string;start:string;end:string;segment_id?:string},cursor=""){setBusy(true);try{const q=new URLSearchParams({aslung_id:params.id,start:params.start,end:params.end,cursor,...(params.segment_id ? {segment_id:params.segment_id} : {})});const p=await request("/api/data?"+q);setPage(p);setQueried(params);return {count:p.data.length,has_more:p.has_more};}catch(e){setPage(null);setQueried(null);toast.error((e as Error).message);throw e;}finally{setBusy(false)}}
 function parameters(){if(!id||!start||!end)throw new Error("請選擇 ASLUNG ID 和完整查詢期間。");const s=zoned(start),e=zoned(end);if(s>e)throw new Error("結束時間必須晚於開始時間。");const selected=downloadDevices.find(d=>d.selection_id===id);if(!selected)throw new Error("請選擇可存取的追蹤區段。");return {id:selected.id,segment_id:selected.segment_id,start:s,end:e};}
   const checkDeviceRange = useCallback((dev: Device, qStartStr: string, qEndStr: string) => {
    if (dev?.invalid_range) return {status: "OUT_OF_RANGE" as const};
    if (!dev || !dev.tracking_ranges || dev.tracking_ranges.length === 0) {
      return { status: "OK" as const, validStart: zoned(qStartStr), validEnd: zoned(qEndStr) };
    }
    const qS = new Date(zoned(qStartStr)).getTime();
    const qE = new Date(zoned(qEndStr)).getTime();

    const overlaps: Array<{ start: string; end: string }> = [];
    for (const tr of dev.tracking_ranges) {
      const rS = new Date(tr.start).getTime();
      const rE = tr.end ? new Date(tr.end).getTime() : Infinity;

      if (qS <= rE && qE >= rS) {
        const overlapStart = Math.max(qS, rS);
        const overlapEnd = rE === Infinity ? qE : Math.min(qE, rE);
        if (overlapStart <= overlapEnd) {
          overlaps.push({
            start: new Date(overlapStart).toISOString(),
            end: new Date(overlapEnd).toISOString()
          });
        }
      }
    }

    if (overlaps.length === 0) {
      return { status: "OUT_OF_RANGE" as const };
    }

    const best = {start: overlaps[0].start, end: overlaps[overlaps.length - 1].end};
    const isPartiallyOutOfRange = new Date(best.start).getTime() > qS || new Date(best.end).getTime() < qE;

    if (isPartiallyOutOfRange) {
      return {
        status: "PARTIAL" as const,
        clippedStart: best.start,
        clippedEnd: best.end,
        ranges: overlaps
      };
    }

    return { status: "OK" as const, validStart: zoned(qStartStr), validEnd: zoned(qEndStr), ranges: overlaps };
  }, [zoned]);

  async function executeDirectDownload(deviceId: string, sIso: string, eIso: string, format: string, segmentId?: string) {
    setBusy(true);
    try {
      const q = new URLSearchParams({ aslung_id: deviceId, start: sIso, end: eIso, format, download: "1", ...(segmentId ? {segment_id:segmentId} : {}) });
      const r = await fetch("/api/data?" + q);
      if (!r.ok) {
        let errMsg = `下載失敗 (${r.status})`;
        try {
          const text = await r.text();
          const j = text ? JSON.parse(text) : {};
          if (j.error) errMsg = j.error;
        } catch {}
        throw new Error(errMsg);
      }
      const href = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = deviceId + "_segment-" + segmentId + "_" + sIso.slice(0, 10) + "_" + eIso.slice(0, 10) + "." + format;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      toast.success("下載完成");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleExecuteQuery() {
    if (batchSelection) {
      void startBatchDownload("csv");
      return;
    }
    try {
      const p = parameters();
      if (chosen) {
        const check = checkDeviceRange(chosen, start, end);
        if (check.status === "OUT_OF_RANGE") {
          toast.error(`設備 ${chosen.id} 在您所選期間未擺放於該站點。請重新選擇在站期間。`);
          return;
        }
        if (check.status === "PARTIAL") {
          const localS = formatInTimeZone(new Date(check.clippedStart), tz, "yyyy-MM-dd'T'HH:mm");
          const localE = formatInTimeZone(new Date(check.clippedEnd), tz, "yyyy-MM-dd'T'HH:mm");
          setClippingWarning({
            device: chosen,
            original: { start, end },
            clipped: { start: localS, end: localE, isoStart:check.clippedStart, isoEnd:check.clippedEnd },
            actionType: "query"
          });
          return;
        }
      }
      void query(p).catch(() => {});
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  function handleExecuteDownload(format: string) {
    if (batchSelection) {
      void startBatchDownload(format);
      return;
    }
    try {
      const p = parameters();
      if (chosen) {
        const check = checkDeviceRange(chosen, start, end);
        if (check.status === "OUT_OF_RANGE") {
          toast.error(`設備 ${chosen.id} 在您所選期間未擺放於該站點。請重新選擇在站期間。`);
          return;
        }
        if (check.status === "PARTIAL") {
          const localS = formatInTimeZone(new Date(check.clippedStart), tz, "yyyy-MM-dd'T'HH:mm");
          const localE = formatInTimeZone(new Date(check.clippedEnd), tz, "yyyy-MM-dd'T'HH:mm");
          setClippingWarning({
            device: chosen,
            original: { start, end },
            clipped: { start: localS, end: localE, isoStart:check.clippedStart, isoEnd:check.clippedEnd },
            actionType: "download",
            format
          });
          return;
        }
      }
      void download(format);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function startBatchDownload(format: string) {
    if (batchRunning) return;
    const targets = downloadDevices.filter(device => selectedDeviceIds.includes(device.selection_id!));
    if (!start || !end) {
      toast.error("請選擇完整開始時間與結束時間。");
      return;
    }
    const sIso = zoned(start);
    const eIso = zoned(end);
    if (sIso > eIso) {
      toast.error("結束時間必須晚於開始時間。");
      return;
    }
    if (!admin && new Date(eIso).getTime() - new Date(sIso).getTime() > 31 * 86400000) {
      toast.error("為維持效能，一般會員批次下載區間不可超過 31 天。請縮短日期範圍。");
      return;
    }
    if (!targets.length) {
      toast.error("請至少勾選一台可存取的設備。");
      return;
    }

    setBatchModalOpen(true);
    setBatchRunning(true);
    setBatchProgress(0);
    setBatchBlobUrl("");
    setBatchZipFilename("");

    const initialLogs = targets.map(d => ({
      id: `${d.grant_lab_id || ""}：${d.id} #${d.segment_id}`,
      status: "waiting" as const,
      message: d.description || d.name || ""
    }));
    setBatchLogs(initialLogs);

    const zip = new JSZip();
    let manifestText = "==================================================\r\n";
    manifestText += "  ASLUNG 設備資料批次匯出清單報告 (Manifest)\r\n";
    manifestText += "==================================================\r\n";
    manifestText += `匯出時間：${localTime(new Date().toISOString())}\r\n`;
    manifestText += `使用者帳號：${state?.me.email} (${state?.me.name})\r\n`;
    manifestText += `所選查詢區間：${start} ～ ${end}\r\n`;
    manifestText += `匯出格式：${format.toUpperCase()}\r\n\r\n`;
    manifestText += "設備匯出明細：\r\n";

    let successCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < targets.length; i++) {
      const dev = targets[i];
      setBatchLogs(prev => prev.map((l, idx) => idx === i ? { ...l, status: "fetching" } : l));

      const check = checkDeviceRange(dev, start, end);
      if (check.status === "OUT_OF_RANGE") {
        skippedCount++;
        const msg = dev.tracking_ranges && dev.tracking_ranges.length > 0 ? "所選期間未擺放於該站點" : "無有效授權紀錄";
        manifestText += `${i + 1}. ${dev.id} [${dev.grant_lab_id || "-"} / segment ${dev.segment_id}]: 略過 (${msg})\r\n`;
        setBatchLogs(prev => prev.map((l, idx) => idx === i ? { ...l, status: "skipped", message: msg } : l));
      } else {
        const devStart = check.status === "PARTIAL" ? check.clippedStart : sIso;
        const devEnd = check.status === "PARTIAL" ? check.clippedEnd : eIso;
        const rangeDescription = (check.ranges || [{start:devStart,end:devEnd}])
          .map(range => `${localTime(range.start)} ~ ${localTime(range.end)}`).join("；");
        try {
          const q = new URLSearchParams({ aslung_id: dev.id, segment_id: dev.segment_id!, start: devStart, end: devEnd, format, download: "1" });
          const res = await fetch("/api/data?" + q);
          if (!res.ok) {
            let errMsg = `下載失敗 (${res.status})`;
            try {
              const text = await res.text();
              const j = text ? JSON.parse(text) : {};
              if (j.error) errMsg = j.error;
            } catch {
              errMsg = `${res.status} ${res.statusText || "伺服器錯誤"}`.trim();
            }
            if (res.status === 401) {
              setBatchRunning(false);
              toast.error("登入已過期或失效，請重新登入系統。");
              throw new Error("登入已過期");
            }
            throw new Error(errMsg);
          }
          const content = await res.text();
          const lines = content.trim().split("\n");
          const recordCount = format === "csv" ? Math.max(0, lines.length - 1) : 0;
          if (recordCount === 0 && format === "csv") {
            skippedCount++;
            manifestText += `${i + 1}. ${dev.id} [${dev.grant_lab_id || "-"} / segment ${dev.segment_id}]: 略過 (有效期間內無回報數據)\r\n`;
            setBatchLogs(prev => prev.map((l, idx) => idx === i ? { ...l, status: "skipped", message: "此期間無數據" } : l));
          } else {
            successCount++;
            const fName = `${dev.id}_segment-${dev.segment_id}_${devStart.slice(0, 10)}_${devEnd.slice(0, 10)}.${format}`;
            zip.file(fName, content);
            manifestText += `${i + 1}. ${dev.id} [${dev.grant_lab_id || "-"} / segment ${dev.segment_id}]: 成功 (匯出 ${recordCount} 筆，有效授權區間: ${rangeDescription})\r\n`;
            setBatchLogs(prev => prev.map((l, idx) => idx === i ? { ...l, status: "success", count: recordCount, validRange: rangeDescription } : l));
          }
        } catch (e: any) {
          skippedCount++;
          manifestText += `${i + 1}. ${dev.id} [${dev.grant_lab_id || "-"} / segment ${dev.segment_id}]: 錯誤 (${e.message})\r\n`;
          setBatchLogs(prev => prev.map((l, idx) => idx === i ? { ...l, status: "error", message: e.message } : l));
          if (e.message.includes("登入已過期")) {
            break;
          }
        }
      }
      setBatchProgress(Math.round(((i + 1) / targets.length) * 100));
    }

    manifestText += `\r\n總計完成：${successCount} 個區段成功，${skippedCount} 個區段略過。\r\n==================================================\r\n`;
    zip.file("download_manifest.txt", manifestText);

    try {
      const blob = await zip.generateAsync({ type: "blob" });
      const blobUrl = URL.createObjectURL(blob);
      const zipName = `ASLUNG_Export_${start.slice(0, 10)}_${end.slice(0, 10)}.zip`;
      setBatchBlobUrl(blobUrl);
      setBatchZipFilename(zipName);
      setBatchRunning(false);

      if (successCount > 0) {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = zipName;
        a.click();
        toast.success(`批次打包完成！已下載 ${successCount} 台設備資料。`);
      } else {
        toast.warning("所選區間內設備無量測回報數據，已產出清單報告。");
      }
    } catch (e: any) {
      setBatchRunning(false);
      toast.error("ZIP 封裝失敗：" + e.message);
    }
  }

  async function download(format: string) {
    setBusy(true);
    try {
      const p = parameters();
      const q = new URLSearchParams({ aslung_id: p.id, start: p.start, end: p.end, format, download: "1", ...(p.segment_id ? {segment_id:p.segment_id} : {}) });
      const r = await fetch("/api/data?" + q);
      if (!r.ok) {
        let errMsg = `下載失敗 (${r.status})`;
        try {
          const text = await r.text();
          const j = text ? JSON.parse(text) : {};
          if (j.error) errMsg = j.error;
        } catch {}
        throw new Error(errMsg);
      }
      const href = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = p.id + "_segment-" + p.segment_id + "_" + start.slice(0, 10) + "_" + end.slice(0, 10) + "." + format;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      toast.success("下載完成");
    } catch (e: any) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
 useEffect(()=>{const context=(document as any).modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();void Promise.resolve(context.registerTool({name:"query_aslung_data",title:"查詢 ASLUNG 量測資料",description:"依授權設備與 UTC 期間查詢一頁量測資料，並更新頁面結果。",inputSchema:{type:"object",properties:{aslung_id:{type:"string"},start:{type:"string"},end:{type:"string"}},required:["aslung_id","start","end"],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async(input:any)=>{if(!input||typeof input.aslung_id!=="string"||!Number.isFinite(Date.parse(input.start))||!Number.isFinite(Date.parse(input.end))||Date.parse(input.start)>Date.parse(input.end))throw new Error("無效查詢參數");if(!devices.some(d=>d.id===input.aslung_id))throw new Error("未授權的設備");setSection("data");setId(input.aslung_id);const local=(v:string)=>formatInTimeZone(new Date(v), tz, "yyyy-MM-dd'T'HH:mm");setStart(local(input.start));setEnd(local(input.end));return query({id:input.aslung_id,start:new Date(input.start).toISOString(),end:new Date(input.end).toISOString()});}},{signal:lifecycle.signal})).catch(()=>{});return()=>lifecycle.abort();},[devices]);
 const labels: Record<string, string> = {
  realtime: isEn ? "Realtime Status" : "即時線上狀態",
  data: isEn ? "Data Query" : "資料查詢",
  devices: isEn ? "Devices" : "ASLUNG ID 管理",
  members: isEn ? "Members" : "會員管理",
  permissions: isEn ? "Permissions" : "資料授權",
  locations: isEn ? "Device Tracking" : "設備追蹤",
  labs: isEn ? "Sites & Labs" : "地點庫 (Lab ID)",
  maintainers: isEn ? "Maintainers" : "維護人員名單",
  alerts: isEn ? "Alert Monitoring" : "斷線告警監控",
  files: isEn ? "Files" : "檔案專區",
  connection: isEn ? "Data Integration" : "資料串接"
 };
 const nav=[{id:"realtime",name:labels.realtime,icon:RadioTower},{id:"data",name:labels.data,icon:Activity},{id:"devices",name:labels.devices,icon:Database},{id:"members",name:labels.members,icon:Users},{id:"permissions",name:labels.permissions,icon:ShieldCheck},{id:"locations",name:labels.locations,icon:MapPin},{id:"labs",name:labels.labs,icon:Building2},{id:"maintainers",name:labels.maintainers,icon:UserCheck},{id:"alerts",name:labels.alerts,icon:BellRing},{id:"files",name:labels.files,icon:FolderDown},{id:"connection",name:labels.connection,icon:Code2}];
 const chosen=downloadDevices.find(d=>d.selection_id===id); let columns=Array.from(new Set((page?.data??[]).flatMap(Object.keys)));if(columns.includes("timestamp"))columns=["timestamp",...columns.filter(c=>c!=="timestamp")];
 
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
 
  useEffect(() => {
    if (modal === "qrScanner" && qrScanning) {
      let scanner: any;
      import("html5-qrcode").then((m) => {
        scanner = new m.Html5QrcodeScanner("reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
        scanner.render((text: string) => {
          scanner.clear();
          setQrScanning(false);
          let targetId = text.trim(); try { if (targetId.startsWith("http://") || targetId.startsWith("https://")) { const u = new URL(targetId); const pId = u.searchParams.get("id") || u.searchParams.get("device") || u.searchParams.get("aslung_id"); if (pId) targetId = pId; } } catch {} setSearch(targetId); setId(targetId);
          setSection("devices");
          setModal("");
          toast.success("掃描成功：" + text);
        }, () => {});
      });
      return () => {
        if (scanner) scanner.clear().catch(()=>{});
      }
    }
  }, [modal, qrScanning]);

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

  const parseAndImportLocationCsv = async (text: string, _onlyAslung = true) => {
    setFleetImportText(text);
    setModal("locationImport");
  };

  const handleLocationCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await parseAndImportLocationCsv(text, true);
    } catch (err: any) {
      toast.error("讀取檔案失敗：" + err.message);
    } finally {
      e.target.value = "";
    }
  };


 return <SidebarProvider id="sidebar-provider" style={{"--sidebar-width":"245px"} as React.CSSProperties}><Toaster richColors position="top-center"/>
 {signedIn && <Sidebar className="nav-rail"><SidebarResizer /><SidebarHeader className="brand"><div className="brand-mark"><Activity size={24}/></div><div><strong>ASLUNG</strong><span>DATA MANAGEMENT</span></div></SidebarHeader><SidebarContent><div className="nav-caption">工作空間</div><SidebarMenu className="px-4">{nav.filter(n=>state && (admin || ["realtime","data","files","connection"].includes(n.id) || (n.id==="alerts" && isMaintainer))).map(n=><SidebarMenuItem key={n.id}><SidebarMenuButton className="nav-button" isActive={section===n.id} onClick={()=>{setSection(n.id);setSearch("")}}><n.icon/><span>{n.name}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu><div className="px-4 py-2 lg:hidden"><div className="text-[11px] text-slate-400 mb-1.5 flex items-center gap-1"><Clock size={12}/> 時區設定 (Timezone)</div><Select value={tz} onValueChange={v => { setTz(v); localStorage.setItem("aslung_tz", v); }}><SelectTrigger className="w-full h-8 text-xs bg-slate-800 text-slate-200 border-slate-700"><SelectValue/></SelectTrigger><SelectContent>{allTimeZones.map(t => <SelectItem key={t.tz} value={t.tz}>{t.label}</SelectItem>)}</SelectContent></Select></div><div className="rail-note"><LockKeyhole size={18}/><strong>依會員授權存取</strong><p>設備與資料期間由管理員指定。</p></div></SidebarContent><SidebarFooter className="rail-footer"><div className="avatar">{state?.me.name?.slice(0,1)??"A"}</div><div className="identity"><strong>{state?.me.name??"ASLUNG 工作空間"}</strong><span>{state?(admin?"管理員":"會員"):"請登入後使用"}</span>{signedIn&&<button className="block text-xs underline mt-1" onClick={()=>setModal("password")}>變更密碼</button>}{signedIn&&<button className="block text-xs underline mt-1" onClick={()=>setModal("profile")}>{isEn?"My collaboration profile":"我的合作資料"}</button>}</div>{signedIn&&<Button variant="ghost" size="icon" aria-label="登出" onClick={async()=>{try{await request("/api/auth/logout",{method:"POST"});window.location.assign("/login")}catch(e){toast.error((e as Error).message)}}}><LogOut size={17}/></Button>}</SidebarFooter></Sidebar>}
 <main className="workspace">{signedIn && <header className="topbar"><div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1"><SidebarTrigger title="顯示/隱藏側邊欄"/><span className="breadcrumb min-w-0 truncate whitespace-nowrap"><span className="hidden sm:inline">工作空間 <span>/</span> </span><strong>{labels[section]}</strong></span></div><div className="top-meta flex items-center gap-2 sm:gap-3 shrink-0"><div className="hidden sm:flex"><FontSizeAdjuster /></div><LanguageSwitcher /><div className="hidden lg:flex timezone"><Select value={tz} onValueChange={v => { setTz(v); localStorage.setItem("aslung_tz", v); }}><SelectTrigger className="w-56 h-8 text-xs bg-white/50 border-slate-200"><SelectValue/></SelectTrigger><SelectContent>{allTimeZones.map(t => <SelectItem key={t.tz} value={t.tz}>{t.label}</SelectItem>)}</SelectContent></Select></div></div></header>}
  <div className="main-inner"><div className="page-heading"><div><p className="eyebrow">ASLUNG DATA HUB</p><h1>{labels[section]}</h1><p className="subheading">{{realtime:"檢視所有授權設備的最後回報狀態與數值。",data:"選擇設備與期間，查詢並下載您有權限的量測資料。",devices:"集中掌握設備狀態、部署與負責人，透過批次操作與履歷追蹤日常異動。",members:"管理可登入工作空間的會員帳號。",permissions:"指定每位會員可存取的設備與資料期間。",locations:"追蹤設備分配至各實驗室或國外的擺放位置歷史紀錄。",labs:"管理實驗室、國外站點與各監測地點的基本資料與座標。",maintainers:"管理儀器負責人與維護人員聯絡信箱，支援 Google 試算表同步。",alerts:admin?"自訂定時檢查設備狀態，當設備斷線超過門檻時自動發送通知信給維護者。":"檢視被授權及您所列管設備的連線監控狀態與斷線告警日誌。",files:admin?"上傳管理檔案，並指定授權特定成員下載與檢視。":"檢視與下載管理員授權給您的專屬檔案資料。",connection:isEn ? "Connect to AWS EC2 data source, query JSON API, and view complete documentation." : "透過 JSON 交換資料，連接 AWS EC2 量測資料來源與完整的 API 使用指南。"}[section]}</p></div>{signedIn&&state&&<Button variant="outline" disabled={loading} onClick={()=>void load()}><RefreshCw size={15} className={loading?"animate-spin":""}/>重新整理</Button>}</div>
 {!signedIn?<section className="panel welcome"><div className="welcome-icon"><ShieldCheck size={38}/></div><p className="eyebrow">安全資料存取</p><h2>登入您的 ASLUNG 工作空間</h2><p>使用 Email 與密碼登入，查看您的設備與資料授權。<br/>管理員可建立 ASLUNG ID、開通會員與指定資料期間。</p><Button asChild size="lg"><a href={signInUrl} target="_top">使用 Email 登入</a></Button><div className="welcome-foot"><LockKeyhole size={14}/>帳號由管理員建立；請使用您的 Email 與密碼登入。</div></section>:error?<section className="panel"><Blank title="無法開啟工作空間" description={error} icon={LockKeyhole}/><div className="text-center pb-8"><Button onClick={()=>void load()}>重試</Button></div></section>:!state?<div className="panel p-8 space-y-5"><Skeleton className="h-9 w-48"/><Skeleton className="h-32 w-full"/></div>:<>
 {section!=="devices"&&<div className="stats"><div><span>{admin?"可存取設備":"可存取與列管設備"}</span><strong>{devices.length.toString().padStart(2,"0")}</strong><Database/></div><div><span>{admin?"有效會員":"帳號權限"}</span><strong>{admin?members.filter(m=>m.active&&m.role==="member").length.toString().padStart(2,"0"):"會員"}</strong><Users/></div><div><span>{admin?"資料授權":"授權期間"}</span><strong>{admin?grants.length.toString().padStart(2,"0"):"依設備設定"}</strong><ShieldCheck/></div><div><span>網站瀏覽次數</span><strong className="source-stat" title={`累計瀏覽：${state?.siteStats?.totalViews ?? 0} 次，今日：${state?.siteStats?.todayViews ?? 0} 次`}>{(state?.siteStats?.totalViews ?? 0).toLocaleString()} <span className="text-xs font-normal text-slate-500">次</span></strong><span className="status ok" title="今日造訪人次">今日 {state?.siteStats?.todayViews ?? 0} 次</span></div></div>}
 {section==="realtime"&&<>{admin&&<RealtimeDiscovery api={request} onResults={rows=>{discoveredDeviceIds.current=rows.map(r=>String(r.aslung_id));const knownIds=new Set(devices.map(d=>d.id));setRealtimeData(previous=>previous?previous.filter(r=>knownIds.has(r.aslung_id)):null);setDiscoveredRealtime(rows);}}/>}<p className="mb-3 text-xs text-slate-500">未部署且超過一年未回報的設備不顯示；使用中設備保留顯示。{combinedRealtime.length>visibleRealtime.length?` 本次已隱藏 ${combinedRealtime.length-visibleRealtime.length} 台。`:""}</p><section className="panel results"><div className="results-heading"><div><h2>設備即時線上狀態</h2><p className="flex items-center gap-2"><span>顯示授權設備的最新一筆量測紀錄（{realtimeInterval > 0 ? `每 ${formatRealtimeInterval(realtimeInterval)}自動更新` : "已暫停自動更新"}）。</span>{realtimeRefreshedAt && <span className="text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded font-mono">最後更新：{formatInTimeZone(realtimeRefreshedAt, tz, "HH:mm:ss")}</span>}</p></div><div className="flex gap-2 items-center flex-wrap"><Input placeholder="搜尋 ID 或位置" className="w-44 bg-white h-9 text-xs" value={realtimeSearch} onChange={e=>setRealtimeSearch(e.target.value)} /><div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 h-9 rounded-md text-xs text-slate-600"><Clock size={13} className="text-slate-500 shrink-0" /><span className="whitespace-nowrap">{admin ? "預設更新時間：" : "更新頻率："}</span><select value={realtimeInterval} className="bg-transparent font-medium text-slate-800 outline-none cursor-pointer pr-1" aria-label={admin ? "預設更新時間" : "個人更新頻率"} title={admin ? "修改全站預設更新時間" : "只影響此帳號在本瀏覽器的畫面"} disabled={busy || !state} onChange={e => { void updateRealtimeInterval(Number(e.target.value)); }}>{(admin ? ADMIN_REALTIME_INTERVALS : MEMBER_REALTIME_INTERVALS).map(seconds => <option key={seconds} value={seconds}>每 {formatRealtimeInterval(seconds)}</option>)}<option value="0">暫停自動更新</option></select></div><Button variant="outline" size="sm" className="h-9" disabled={realtimeLoading} onClick={() => { void fetchRealtime(true); }}><RefreshCw size={14} className={realtimeLoading ? "animate-spin" : ""} />{realtimeLoading ? "更新中…" : "更新"}</Button></div></div>{!realtimeData&&!discoveredRealtime.length?<div className="p-8"><Skeleton className="h-32 w-full"/></div>:visibleRealtime.length===0?<Blank title="尚無可顯示的即時資料" description="可能尚無量測紀錄，或未部署設備已超過一年未回報。管理員可搜尋未建檔設備。"/>:(()=>{const filtered=visibleRealtime.filter(r=>{if(!admin){const dev=devices.find(d=>d.id===r.aslung_id);if(!dev)return false;if(dev.grant_source==="lab"&&!dev.is_active_at_lab&&!dev.is_maintained)return false;}if(!realtimeSearch)return true;const s=realtimeSearch.toLowerCase();const loc=currentDeployments.get(r.aslung_id)?.lab_id||"";return String(r.aslung_id).toLowerCase().includes(s)||loc.toLowerCase().includes(s);});return <div className="table-scroll"><Table><TableHeader><TableRow><TableHead className="w-12 text-center font-semibold">序號</TableHead><TableHead>狀態</TableHead><TableHead>目前位置</TableHead><TableHead>timestamp</TableHead><TableHead>aslung_id</TableHead><TableHead>PM1_G3</TableHead><TableHead>PM2.5_G3</TableHead><TableHead>PM10_G3</TableHead><TableHead>temperature</TableHead><TableHead>rh</TableHead><TableHead>co2</TableHead><TableHead>PM1_GSA</TableHead><TableHead>PM2.5_GSA</TableHead><TableHead>PM10_GSA</TableHead></TableRow></TableHeader><TableBody>{filtered.length===0?<TableRow><TableCell colSpan={14} className="text-center py-8 text-slate-500">沒有符合搜尋條件的設備</TableCell></TableRow>:filtered.map((r,i)=>{const isOffline=Date.now()-new Date(r.timestamp).getTime()>3600000;const dev=devices.find(d=>d.id===r.aslung_id);const loc=currentDeployments.get(r.aslung_id)?.lab_id||<span className="text-slate-400">{dev?"未部署":"未建檔"}</span>;return <TableRow key={i}><TableCell className="text-center font-mono text-xs text-slate-500">{i+1}</TableCell><TableCell><span className={isOffline?"status pending":"status ok"}>{isOffline?"已斷線":"連線中"}</span></TableCell><TableCell>{loc}</TableCell><TableCell className="mono font-medium">{localTime(String(r.timestamp))}</TableCell><TableCell className="mono font-medium"><div className="flex items-center gap-1.5"><span>{String(r.aslung_id)}</span>{admin&&!dev&&<><span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-sans text-[10px] text-amber-800">未建檔</span><Button size="xs" variant="outline" onClick={()=>{setEditDevice(null);setLiveQrId(String(r.aslung_id));setModal("device");}}>補登設備</Button></>}{!admin&&dev?.is_maintained&&<span className="text-[10px] px-1.5 py-0.5 rounded font-sans font-medium bg-amber-50 text-amber-800 border border-amber-200">列管</span>}{!admin&&dev?.is_granted&&<span className="text-[10px] px-1.5 py-0.5 rounded font-sans font-medium bg-blue-50 text-blue-800 border border-blue-200">授權</span>}</div></TableCell><TableCell>{String(r.PM1_G3??"—")}</TableCell><TableCell>{String(r["PM2.5_G3"]??"—")}</TableCell><TableCell>{String(r.PM10_G3??"—")}</TableCell><TableCell>{String(r.temperature??"—")}</TableCell><TableCell>{String(r.rh??"—")}</TableCell><TableCell>{String(r.co2??"—")}</TableCell><TableCell>{String(r.PM1_GSA??"—")}</TableCell><TableCell>{String(r["PM2.5_GSA"]??"—")}</TableCell><TableCell>{String(r.PM10_GSA??"—")}</TableCell></TableRow>})}</TableBody></Table></div>})()}</section></>}
 {section==="data"&&<><section className="panel query-panel"><div className="panel-title flex items-center justify-between"><div><span><Search size={18}/> 查詢條件</span><small className="ml-2">時間以所選時區 ({tz}) 計算</small></div>{!admin&&<Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-teal-700 border-teal-300 hover:bg-teal-50" onClick={()=>{setRequestType("lab");setRequestAslungId("");setRequestLabId("");setRequestReason("");setModal("requestGrant")}}><KeyRound size={14}/>{isEn ? "Request Data Access" : "申請資料授權"}{grantRequests.filter(r=>r.status==="PENDING").length>0&&<span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">{grantRequests.filter(r=>r.status==="PENDING").length}</span>}</Button>}</div><form onSubmit={e=>{e.preventDefault();handleExecuteQuery();}} className="query-form"><div><Label>ASLUNG ID</Label><p className="mb-1 text-xs text-slate-500">{isEn ? `${new Set(downloadDevices.map(d=>d.id)).size} devices / ${downloadDevices.length} tracking segments` : `${new Set(downloadDevices.map(d=>d.id)).size} 台設備／${downloadDevices.length} 個追蹤區段`}</p><DeviceMultiSelect options={deviceDownloadOptions} value={selectedDeviceIds} onValueChange={selectDownloadDevices} disabled={busy || batchRunning} isEnglish={isEn}/></div><div><Label htmlFor="start">開始時間</Label><Input id="start" type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></div><div><Label htmlFor="end">結束時間</Label><Input id="end" type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></div><Button key={batchSelection ? "batch-submit" : "single-submit"} disabled={busy||batchRunning||!id} type="submit" className="h-11"><Search size={16}/>{busy?"處理中…":batchSelection?"打包下載 CSV (ZIP)":"查詢資料"}</Button></form>{batchSelection ? (
  <div className="permission-note bg-teal-50/70 border border-teal-200 text-teal-900 p-3 rounded-lg text-xs space-y-1 mt-3">
    <div className="flex items-center gap-1.5 font-bold">
      <FolderDown size={15} className="text-teal-700" />
      <span>已選擇：{id === "__ALL__" ? "下載所有授權資料" : "指定設備打包下載"}（{new Set(downloadDevices.filter(d=>selectedDeviceIds.includes(d.selection_id!)).map(d=>d.id)).size} 台設備／{selectedDeviceIds.length} 個追蹤區段）</span>
    </div>
  </div>
) : chosen ? (
  <div className="permission-note space-y-1.5 text-xs bg-slate-50 border p-3 rounded-lg mt-3">
    <div className="flex items-center gap-2 flex-wrap">
      <ShieldCheck size={15} className="text-teal-600 shrink-0" />
      <span className="font-semibold text-slate-800">
        {chosen.grant_source === "lab" ? `授權來源：地點授權【${chosen.grant_lab_id || ""}${chosen.grant_lab_name ? " " + chosen.grant_lab_name : ""}】` : `追蹤區段：${chosen.grant_lab_id || ""}：${chosen.id} #${chosen.segment_id}`}
      </span>
      {chosen.is_active_at_lab ? (
        <span className="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">現役運作中</span>
      ) : (
        <span className="text-[10px] px-1.5 py-0.2 rounded font-semibold bg-slate-200 text-slate-700">歷史調度設備</span>
      )}
    </div>
    {chosen.tracking_ranges && chosen.tracking_ranges.length > 0 ? (
      <div className="text-slate-600 pl-5 leading-relaxed">
        <span className="font-medium text-slate-700">可下載資料期間：</span>
        {chosen.tracking_ranges.map((tr, idx) => (
          <span key={idx} className="inline-block max-w-full whitespace-normal break-words font-mono ml-1 text-slate-800 font-semibold bg-white px-1.5 py-0.5 rounded border border-slate-200">
            {localTime(tr.start)} ～ {tr.end ? localTime(tr.end) : "至今 (無期限)"}
            {idx < (chosen.tracking_ranges?.length || 0) - 1 ? "、" : ""}
          </span>
        ))}
      </div>
    ) : chosen.start ? (
      <div className="text-slate-600 pl-5">
        授權資料期間：<span className="font-mono font-medium">{localTime(chosen.start)} ～ {chosen.end ? localTime(chosen.end) : "無限制"}</span>
      </div>
    ) : null}
  </div>
) : null}</section>
  <section className="panel results"><div className="results-heading"><div><h2>量測資料 <span>{page?.data.length??0} 筆／本頁</span></h2><p>{queried?queried.id+" · "+localTime(queried.start)+" ～ "+localTime(queried.end):"查詢後顯示所選期間的量測紀錄"}</p></div><div className="flex gap-2">
  <Button key={batchSelection ? "batch-csv" : "single-csv"} variant="outline" disabled={busy||batchRunning||(!batchSelection&&(!page||!queried))} onClick={()=>handleExecuteDownload("csv")}>
    <Download size={15}/>{batchSelection ? "打包下載 CSV (ZIP)" : "CSV"}
  </Button>
  <Button key={batchSelection ? "batch-json" : "single-json"} variant="outline" disabled={busy||batchRunning||(!batchSelection&&(!page||!queried))} onClick={()=>handleExecuteDownload("json")}>
    <FileJson size={15}/>{batchSelection ? "打包下載 JSON (ZIP)" : "JSON"}
  </Button>
</div></div>
  <Tabs defaultValue="table"><TabsList variant="line" className="mx-6"><TabsTrigger value="table">資料表</TabsTrigger><TabsTrigger value="json">JSON 預覽</TabsTrigger></TabsList><TabsContent value="table">{!page?<Blank title={devices.length?"尚未查詢資料":"尚無可存取設備"} description={devices.length?"選擇 ASLUNG ID 與期間，按下「查詢資料」。":admin?"先在 ASLUNG ID 管理建立設備，再設定資料來源。":"您目前尚無已授權的設備。您可以點擊右上角「申請設備授權」輸入 ASLUNG ID 向管理員申請存取權限。"} icon={Search}/>:page.data.length===0?<Blank title="此期間沒有量測資料" description="請調整日期範圍後重新查詢。"/>:<div className="table-scroll"><Table><TableHeader><TableRow>{columns.map(k=><TableHead key={k}>{k}</TableHead>)}</TableRow></TableHeader><TableBody>{page.data.map((r,i)=><TableRow key={i}>{columns.map(k=><TableCell key={k} className={k==="timestamp"?"mono":""}>{k==="timestamp"?localTime(String(r[k])):typeof r[k]==="object"?JSON.stringify(r[k]):String(r[k]??"—")}</TableCell>)}</TableRow>)}</TableBody></Table></div>}</TabsContent><TabsContent value="json"><pre className="json-box">{page?JSON.stringify({aslung_id:queried?.id,start:queried?.start,end:queried?.end,...page},null,2):"// 查詢完成後，將在此顯示實際 JSON 資料。"}</pre></TabsContent></Tabs>{page?.has_more&&queried&&<div className="table-footer"><span>尚有更多資料；下載會自動合併所有分頁。</span><Button variant="outline" disabled={busy} onClick={()=>void query(queried,page.next_cursor!).catch(()=>{})}>下一頁</Button></div>}</section>
 {admin && <div className="source-note"><Server size={18}/><div><strong>{state.connected?"EC2 MySQL 資料庫已連線":"AWS EC2 尚未串接"}</strong><p>{state.connected?"查詢結果直接來自既有資料來源；連線是否正常將於查詢時確認。":"會員、設備與授權可以先行設定。完成 API 串接後，即可查詢與下載實際資料。"}</p></div><Button variant="ghost" onClick={()=>setSection("connection")}>查看串接方式</Button></div>}</>}
  {section==="devices"&&admin&&<DeviceFleetView
    devices={devices} locations={locations} labs={labs} maintainers={maintainers} readings={realtimeData}
    alertLogs={alertLogs} grants={grants} userKey={state?.me.email||""} thresholdMins={Number(alertSettings?.offline_threshold_mins)||60}
    selected={selectedDevices} setSelected={setSelectedDevices} api={request} onReload={load} onRefresh={()=>void fetchRealtime(true)} formatTime={localTime}
    onCreate={()=>{setEditDevice(null);setLiveQrId("");setModal("device");}}
    onImport={()=>{setFleetImportText("");setModal("locationImport");}} onGoogle={()=>setModal("locationSync")}
    onEdit={d=>{setEditDevice(d);setLiveQrId(d.id);setModal("device");}}
    onQr={d=>{setQrDevice(d);setModal("deviceQr");}}
    onTransfer={d=>{setTransferDevice(d);setModal("transfer");}}
    onBulkTransfer={()=>{setTransferDevice(null);setModal("transferBulk");}}
    onGrant={id=>{setGrantDevice(id);setModal("grant");}}
    onLegacyImport={()=>setModal("importCsv")}
    onDelete={id=>setConfirmation({action:"deviceDelete",id,title:"刪除此設備？",description:"將一併刪除此設備的資料授權與位置追蹤紀錄，無法復原。"})}
    onBulkDelete={()=>setConfirmation({action:"deviceDeleteBulk",ids:Array.from(selectedDevices),title:`刪除所選 ${selectedDevices.size} 台設備？`,description:"將一併刪除所選設備的資料授權與位置追蹤紀錄，無法復原。"})}
  />}
 {section==="members"&&admin&&<><RegistrationReviews members={members} mailConfigured={!!alertSettings?.smtp_host&&!!alertSettings?.smtp_from} onMailSettings={()=>setModal("alertSettings")} busy={busy} isEnglish={isEn} onReview={(email,decision,note)=>mutate({action:"memberReview",email,decision,note})} onGrant={email=>{setGrantEmail(email);setGrantType("lab");setGrantLab("");setGrantDevice("");setGrantId(null);setModal("grant");}}/><section className="panel"><div className="list-heading"><h2>會員帳號 <span className="count">{members.length}</span></h2><div className="flex gap-2">{selectedMembers.size > 0 && <Button variant="destructive" onClick={()=>{setConfirmation({action:"memberDeleteBulk",emails:Array.from(selectedMembers),title:`刪除所選 ${selectedMembers.size} 位會員？`,description:`將一併刪除所選 ${selectedMembers.size} 位會員的帳號資料、登入憑證與設備授權紀錄，且無法復原。確認刪除？`});}}><Trash2 size={16} className="mr-1"/>大量刪除 ({selectedMembers.size})</Button>}<Button onClick={()=>{setEditMember(null);setModal("member")}}><Plus size={16}/>新增會員</Button></div></div><Table><TableHeader><TableRow><TableHead className="w-12 text-center font-semibold">序號</TableHead><TableHead className="w-10"><input type="checkbox" checked={members.filter(m=>m.email!==state?.me.email).length>0 && selectedMembers.size===members.filter(m=>m.email!==state?.me.email).length} onChange={e=>{if(e.target.checked) setSelectedMembers(new Set(members.filter(m=>m.email!==state?.me.email).map(m=>m.email))); else setSelectedMembers(new Set());}} /></TableHead><TableHead>會員姓名</TableHead><TableHead>帳號 (暱稱)</TableHead><TableHead>Email</TableHead><TableHead>角色</TableHead><TableHead>狀態</TableHead><TableHead>登入次數</TableHead><TableHead>最後登入時間</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{members.map((m,idx)=>{const isMe=m.email===state?.me.email; return <TableRow key={m.email}><TableCell className="text-center font-mono text-xs text-slate-500">{idx+1}</TableCell><TableCell><input type="checkbox" disabled={isMe} checked={selectedMembers.has(m.email)} onChange={e=>{const s=new Set(selectedMembers); if(e.target.checked) s.add(m.email); else s.delete(m.email); setSelectedMembers(s);}} /></TableCell><TableCell className="font-semibold">{m.name}{isMe&&<span className="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-normal">您</span>}</TableCell><TableCell className="font-medium">{m.nickname || <span className="text-slate-400">-</span>}</TableCell><TableCell>{m.email.endsWith("@local.aslung")?<span className="text-slate-400">無</span>:m.email}</TableCell><TableCell>{m.role==="admin"?"管理員":"會員"}</TableCell><TableCell><span className={m.active?"status ok":"status pending"}>{m.registration_status==="pending_email"?"待驗證 Email":m.registration_status==="pending_review"?"待審核":m.registration_status==="rejected"?"未通過":m.active?"已開通":"已停用"}</span></TableCell><TableCell className="font-mono text-sm">{m.login_count || 0} 次</TableCell><TableCell className="text-xs text-slate-500">{m.last_login_at ? localTime(m.last_login_at) : <span className="text-slate-400">從未登入</span>}</TableCell><TableCell><div className="flex gap-2 items-center"><Button variant="ghost" size="icon-xs" title="編輯" onClick={()=>{setEditMember(m); setModal("member")}}><Pencil size={15}/></Button>{!isMe && (!m.registration_status||m.registration_status==="approved") && <Button variant="outline" size="sm" onClick={()=>setConfirmation({action:"memberRole",email:m.email,role:m.role==="admin"?"member":"admin",title:m.role==="admin"?"降為一般會員？":"升級為管理員？",description:m.role==="admin"?"此帳號將無法再管理系統。":"此帳號將能管理系統設定與其他帳號。"})}>{m.role==="admin"?"降為會員":"設為管理員"}</Button>}{m.role==="member"&&(!m.registration_status||m.registration_status==="approved")&&<Button variant="outline" size="sm" onClick={()=>setConfirmation({action:"memberStatus",email:m.email,active:!m.active,title:m.active?"停用會員？":"恢復會員？",description:m.active?"此會員將無法查詢或下載資料，既有授權仍保留。":"此會員可重新使用已指派的設備授權。"})}>{m.active?"停用":"恢復"}</Button>}{!isMe && <Button variant="ghost" size="icon-xs" title="刪除會員" className="text-red-500 hover:text-red-600 hover:bg-red-50 ml-1" onClick={()=>setConfirmation({action:"memberDelete",email:m.email,title:`刪除會員「${m.name}」？`,description:`確定要刪除會員「${m.name}」(${m.nickname||m.email})？此操作將一併移除該會員的所有設備資料授權與登入紀錄，且無法復原。確認刪除？`})}><Trash2 size={15}/></Button>}</div></TableCell></TableRow>;})}</TableBody></Table><p className="panel-footnote">管理員建立帳號後，請自行將帳號暱稱與初始密碼交給會員；此操作不會寄送邀請信。會員可於登入後變更密碼及補填合作資料。自行註冊的申請請由上方清單審核。</p></section></>}
  {section==="locations"&&admin&&(()=>{const filteredLocations=locations.filter(l=>(l.aslung_id+" "+l.lab_id+" "+(l.maintainer||"")).toLowerCase().includes(search.toLowerCase()));return <section className="panel"><div className="list-heading"><div className="flex items-center gap-4"><h2>設備追蹤 <span className="count">{locations.length}</span></h2><Input className="w-64 h-9 bg-white" placeholder="搜尋 ID、地點或負責人..." value={search} onChange={e=>setSearch(e.target.value)} /></div><div className="flex gap-2"><input id="loc-csv-upload" type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleLocationCsvUpload} />{selectedLocations.size > 0 && <Button variant="destructive" onClick={()=>{setConfirmation({action:"locationDeleteBulk",ids:Array.from(selectedLocations),title:`刪除所選 ${selectedLocations.size} 筆追蹤紀錄？`,description:`將一併刪除所選 ${selectedLocations.size} 筆設備擺放位置歷史紀錄，且無法復原。確認刪除？`})}}><Trash2 size={16} className="mr-1"/>大量刪除 ({selectedLocations.size})</Button>}<Button variant="secondary" onClick={()=>setModal("locationSync")}><CloudDownload size={16} className="mr-1"/>同步 Google 試算表</Button><Button variant="outline" onClick={()=>setModal("locationImport")}><FileSpreadsheet size={16} className="mr-1"/>貼上 / 匯入試算表</Button><Button onClick={()=>{setEditLocation(null);setModal("location")}}><Plus size={16}/>新增紀錄</Button></div></div>{!filteredLocations.length?<Blank title={search?"沒有符合的追蹤紀錄":"尚無位置追蹤紀錄"} description={search?"請嘗試其他關鍵字。":"新增第一筆設備擺放位置。"} icon={MapPin}/>:<Table><TableHeader><TableRow><TableHead className="w-12 text-center font-semibold">序號</TableHead><TableHead><input type="checkbox" checked={selectedLocations.size === filteredLocations.length && filteredLocations.length > 0} onChange={e => { if(e.target.checked) setSelectedLocations(new Set(filteredLocations.map(l=>l.id))); else setSelectedLocations(new Set()); }} /></TableHead><TableHead>Lab ID (地點)</TableHead><TableHead>ASLUNG ID</TableHead><TableHead>負責人 / 維護者</TableHead><TableHead>開始時間</TableHead><TableHead>結束時間</TableHead><TableHead>狀態</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{filteredLocations.map((l,idx)=><TableRow key={l.id}><TableCell className="text-center font-mono text-xs text-slate-500">{idx+1}</TableCell><TableCell><input type="checkbox" checked={selectedLocations.has(l.id)} onChange={e => { const s = new Set(selectedLocations); if(e.target.checked) s.add(l.id); else s.delete(l.id); setSelectedLocations(s); }} /></TableCell><TableCell className="font-semibold">{l.lab_id}</TableCell><TableCell className="mono">{l.aslung_id}</TableCell><TableCell>{(()=>{const m=maintainers.find(x=>x.name===l.maintainer);if(!l.maintainer)return <span className="text-slate-400">—</span>;if(!m)return <span className="font-medium text-slate-700">{l.maintainer}</span>;return <div className="flex items-center gap-1.5"><span className="font-semibold text-slate-800">{m.name}</span>{m.email&&<a href={`mailto:${m.email}`} title={`寄信給 ${m.name} (${m.email})`} className="text-teal-600 hover:text-teal-800 transition-colors inline-flex items-center"><Mail size={13}/></a>}</div>;})()}</TableCell><TableCell>{localTime(l.start_time)}</TableCell><TableCell>{l.end_time?localTime(l.end_time):"—"}</TableCell><TableCell><span className={l.active?"status ok":"status pending"}>{l.active?"使用中":"已移出"}</span></TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>{setEditLocation(l); setModal("location")}}>編輯</Button><Button size="sm" variant="outline" onClick={()=>{setConfirmation({action:"locationDelete",id:l.id,title:"刪除此紀錄？",description:"確認後將無法復原。"})}}>刪除</Button></div></TableCell></TableRow>)}</TableBody></Table>}</section>})()}
  {section==="labs"&&admin&&<LabsView labs={labs} locations={locations} search={search} setSearch={setSearch} selectedLabs={selectedLabs} setSelectedLabs={setSelectedLabs} setEditLab={setEditLab} setModal={setModal} setConfirmation={setConfirmation} />}
  {section==="maintainers"&&admin&&<MaintainersView maintainers={maintainers} devices={devices} locations={locations} realtimeData={realtimeData} search={search} setSearch={setSearch} selectedMaintainers={selectedMaintainers} setSelectedMaintainers={setSelectedMaintainers} setEditMaintainer={setEditMaintainer} setModal={setModal} setConfirmation={setConfirmation} />}
  {section==="alerts"&&<AlertsView admin={admin} me={state?.me} alertSettings={alertSettings} alertChecks={alertChecks} alertLogs={alertLogs} devices={devices} locations={locations} maintainers={maintainers} realtimeData={realtimeData} setModal={setModal} load={load} localTime={localTime} selectedAlertChecks={selectedAlertChecks} setSelectedAlertChecks={setSelectedAlertChecks} selectedAlertLogs={selectedAlertLogs} setSelectedAlertLogs={setSelectedAlertLogs} setConfirmation={setConfirmation} />}
 
 {section==="files"&&admin&&(()=>{
   const filteredFiles=files.filter(f=>(f.name+" "+(f.description||"")).toLowerCase().includes(search.toLowerCase()));
   return <section className="panel"><div className="list-heading"><div className="flex items-center gap-4"><h2>檔案管理與授權 <span className="count">{files.length}</span></h2><Input className="w-64 h-9 bg-white" placeholder="搜尋檔案名稱或備註..." value={search} onChange={e=>setSearch(e.target.value)} /></div><Button onClick={()=>{setSelectedFile(null);setUploadDescription("");setUploadEmails(new Set());setModal("fileUpload");}}><Upload size={16} className="mr-1"/>上傳檔案</Button></div>{!filteredFiles.length?<Blank title={search?"沒有符合的檔案":"尚無上傳檔案"} description={search?"請嘗試其他關鍵字。":"上傳第一個檔案，並指定授權可下載與檢視的會員。"} icon={FolderDown}/>:<Table><TableHeader><TableRow><TableHead className="w-12 text-center font-semibold">序號</TableHead><TableHead>檔案名稱</TableHead><TableHead>檔案大小</TableHead><TableHead>說明 / 備註</TableHead><TableHead>上傳時間</TableHead><TableHead>授權會員</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{filteredFiles.map((f,idx)=>{const currentGrants=fileGrants.filter(g=>g.file_id===f.id);return <TableRow key={f.id}><TableCell className="text-center font-mono text-xs text-slate-500">{idx+1}</TableCell><TableCell className="font-semibold"><div className="flex items-center gap-2"><FileText size={18} className="text-teal-600 shrink-0"/><span className="truncate max-w-xs" title={f.name}>{f.name}</span></div></TableCell><TableCell className="mono text-xs text-slate-600">{formatFileSize(f.size)}</TableCell><TableCell className="text-slate-500 text-sm max-w-xs truncate" title={f.description||""}>{f.description||"—"}</TableCell><TableCell>{localTime(f.created_at)}</TableCell><TableCell><span className={`status ${currentGrants.length>0?"ok":"pending"}`}>{currentGrants.length>0?`${currentGrants.length} 位成員`:"尚未授權"}</span></TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" title="在新分頁檢視" onClick={()=>window.open(`/api/files?id=${f.id}&view=1`,"_blank")}><Eye size={14} className="mr-1"/>檢視</Button><Button size="sm" variant="outline" title={`下載檔案（已下載 ${f.download_count || 0} 次）`} onClick={()=>{const a=document.createElement("a");a.href=`/api/files?id=${f.id}&download=1`;a.download=f.name;a.click();setState(prev=>prev?{...prev,files:(prev.files||[]).map(item=>item.id===f.id?{...item,download_count:(item.download_count||0)+1}:item)}:prev);}}><Download size={14} className="mr-1"/>下載<span className="ml-1 text-[11px] px-1.5 py-0.2 rounded bg-slate-100 font-mono text-slate-600 font-normal">{f.download_count || 0}次</span></Button><Button size="sm" variant="outline" onClick={()=>{setSelectedFile(f);setFileGrantEmails(new Set(currentGrants.map(g=>g.email)));setModal("fileGrant");}}><ShieldCheck size={14} className="mr-1"/>設定授權</Button><Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={()=>setConfirmation({action:"fileDelete",id:f.id,title:"刪除此檔案？",description:`確定要刪除「${f.name}」？此操作將同步移除所有會員存取權並從伺服器刪除實體檔案。`})}><Trash2 size={14}/></Button></div></TableCell></TableRow>;})}</TableBody></Table>}</section>;
 })()}
 {section==="files"&&!admin&&(()=>{
   const filteredFiles=files.filter(f=>(f.name+" "+(f.description||"")).toLowerCase().includes(search.toLowerCase()));
   return <section className="panel"><div className="list-heading"><div className="flex items-center gap-4"><div><h2>授權檔案專區 <span className="count">{files.length}</span></h2><p className="text-xs text-slate-500 mt-1">您可在此檢視或下載管理員指派給您的檔案資料。</p></div><Input className="w-64 h-9 bg-white" placeholder="搜尋檔案名稱..." value={search} onChange={e=>setSearch(e.target.value)} /></div></div>{!filteredFiles.length?<Blank title={search?"沒有符合的檔案":"尚無已授權的檔案"} description={search?"請嘗試其他關鍵字。":"管理員尚未指派任何檔案給您的帳號。"} icon={FolderDown}/>:<Table><TableHeader><TableRow><TableHead className="w-12 text-center font-semibold">序號</TableHead><TableHead>檔案名稱</TableHead><TableHead>檔案大小</TableHead><TableHead>說明 / 備註</TableHead><TableHead>發布時間</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{filteredFiles.map((f,idx)=><TableRow key={f.id}><TableCell className="text-center font-mono text-xs text-slate-500">{idx+1}</TableCell><TableCell className="font-semibold"><div className="flex items-center gap-2"><FileText size={18} className="text-teal-600 shrink-0"/><span className="truncate max-w-xs" title={f.name}>{f.name}</span></div></TableCell><TableCell className="mono text-xs text-slate-600">{formatFileSize(f.size)}</TableCell><TableCell className="text-slate-500 text-sm max-w-xs truncate" title={f.description||""}>{f.description||"—"}</TableCell><TableCell>{localTime(f.created_at)}</TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" title="在新分頁檢視" onClick={()=>window.open(`/api/files?id=${f.id}&view=1`,"_blank")}><Eye size={14} className="mr-1"/>檢視</Button><Button size="sm" variant="outline" title={`下載檔案（已下載 ${f.download_count || 0} 次）`} onClick={()=>{const a=document.createElement("a");a.href=`/api/files?id=${f.id}&download=1`;a.download=f.name;a.click();setState(prev=>prev?{...prev,files:(prev.files||[]).map(item=>item.id===f.id?{...item,download_count:(item.download_count||0)+1}:item)}:prev);}}><Download size={14} className="mr-1"/>下載<span className="ml-1 text-[11px] px-1.5 py-0.2 rounded bg-slate-100 font-mono text-slate-600 font-normal">{f.download_count || 0}次</span></Button></div></TableCell></TableRow>)}</TableBody></Table>}</section>;
 })()}

  {section==="permissions"&&admin&&<div className="space-y-6">
    <section className="panel"><div className="list-heading"><div><h2 className="flex items-center gap-2">會員資料授權申請審核 <span className="count">{grantRequests.length}</span>{grantRequests.filter(r=>r.status==="PENDING").length>0&&<span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-300">{grantRequests.filter(r=>r.status==="PENDING").length} 筆待審核</span>}</h2><p className="text-xs text-slate-500 mt-1">會員在資料查詢時提出之地點 (Lab ID) 或設備 (ASLUNG ID) 權限申請；核准後系統將自動開通授權。</p></div></div>{!grantRequests.length?<Blank title="尚無任何申請紀錄" description="當一般會員在資料查詢頁面申請地點或設備資料授權時，將會顯示於此處供管理員審核。" icon={KeyRound}/>:<Table><TableHeader><TableRow><TableHead className="w-12 text-center font-semibold">序號</TableHead><TableHead>申請時間</TableHead><TableHead>申請會員</TableHead><TableHead>申請項目 (類型 / 代碼)</TableHead><TableHead>事由 / 說明</TableHead><TableHead>狀態</TableHead><TableHead>審核紀錄</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{grantRequests.map((req,idx)=><TableRow key={req.id}><TableCell className="text-center font-mono text-xs text-slate-500">{idx+1}</TableCell><TableCell className="mono text-xs">{localTime(req.created_at)}</TableCell><TableCell><span className="font-semibold text-slate-800">{req.member_name||req.email}</span><p className="cell-note">{req.member_nickname||(req.email.endsWith("@local.aslung")?"":req.email)}</p></TableCell><TableCell>{req.request_type==="lab"?<div className="flex items-center gap-1.5 flex-wrap"><span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 border border-blue-200">📍 地點授權</span><span className="mono font-bold text-blue-900">{req.lab_id}</span><span className="text-xs text-slate-500">{[req.city_name,req.town_name,req.location_name].filter(Boolean).join(" ")}</span></div>:<div className="flex items-center gap-1.5"><span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">📟 設備授權</span><span className="mono font-bold text-teal-700">{req.aslung_id}</span></div>}</TableCell><TableCell className="max-w-xs text-sm text-slate-600 truncate" title={req.reason||""}>{req.reason||<span className="text-slate-400">—</span>}</TableCell><TableCell><span className={`status ${req.status==="APPROVED"?"ok":"pending"}`} style={req.status==="PENDING"?{background:"#fef3c7",color:"#92400e",borderColor:"#fde68a"}:req.status==="REJECTED"?{background:"#fee2e2",color:"#991b1b",borderColor:"#fecaca"}:undefined}>{req.status==="APPROVED"?"已核准":req.status==="REJECTED"?"已拒絕":"待審核"}</span></TableCell><TableCell className="text-xs text-slate-500">{req.reviewed_by?<div><span>審核人：{req.reviewed_by}</span>{req.reviewed_at&&<div className="text-[10px] text-slate-400">{localTime(req.reviewed_at)}</div>}</div>:<span className="text-slate-400">—</span>}</TableCell><TableCell><div className="flex gap-1.5 items-center">{req.status==="PENDING"?<><Button size="sm" className="bg-teal-700 hover:bg-teal-800 h-8" onClick={()=>{setReviewRequest(req);setModal("reviewGrant");}}>核准</Button><Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700 h-8" onClick={()=>setConfirmation({action:"reviewGrantRequest",id:req.id,decision:"REJECTED",title:"拒絕此授權申請？",description:`確定要拒絕 ${req.member_name||req.email} 對 ${req.request_type==="lab"?`地點 ${req.lab_id}`:`設備 ${req.aslung_id}`} 的資料授權申請？`})}>拒絕</Button></>:<Button size="sm" variant="ghost" className="text-slate-400 hover:text-red-600 h-8" title="刪除紀錄" onClick={()=>setConfirmation({action:"grantRequestDelete",id:req.id,title:"刪除申請紀錄？",description:"確認後將移除此筆申請紀錄。"})}><Trash2 size={14}/></Button>}</div></TableCell></TableRow>)}</TableBody></Table>}</section>
    <section className="panel"><div className="list-heading"><div><h2>資料存取授權 <span className="count">{grants.length}</span></h2><p className="text-xs text-slate-500 mt-1">管理各會員已開通存取的地點 (Lab ID) 或設備 (ASLUNG ID) 與有效日期區間。</p></div><Button disabled={(!devices.length&&!labs.length)||!members.some(m=>m.role==="member"&&m.active)} onClick={()=>{setGrantType("lab");setGrantLab("");setGrantDevice("");setGrantEmail("");setGrantId(null);setModal("grant")}}><Plus size={16}/>新增授權</Button></div>{!grants.length?<Blank title="尚未指派資料權限" description="先建立地點或 ASLUNG ID 與會員，再指定可查詢的資料期間。" icon={ShieldCheck}/>:<Table><TableHeader><TableRow><TableHead className="w-12 text-center font-semibold">序號</TableHead><TableHead>授權類型與標的</TableHead><TableHead>會員</TableHead><TableHead>可存取資料期間（UTC+8）</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{grants.map((g,idx)=><TableRow key={g.id}><TableCell className="text-center font-mono text-xs text-slate-500">{idx+1}</TableCell><TableCell>{g.grant_type==="lab"?<div><div className="flex items-center gap-1.5 flex-wrap"><span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">📍 地點授權</span><span className="mono font-bold text-slate-800">{g.lab_id}</span><span className="text-xs text-slate-600">{[g.city_name,g.town_name,g.location_name].filter(Boolean).join(" ")}</span></div><div className="text-[11px] text-blue-600 mt-0.5">涵蓋該站點目前 {g.lab_device_count??0} 台設備（動態繼承）</div></div>:<div className="flex items-center gap-1.5"><span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">📟 設備授權</span><span className="mono font-bold text-slate-800">{g.device_id}</span></div>}</TableCell><TableCell>{members.find(m=>m.email===g.email)?.name}<p className="cell-note">{members.find(m=>m.email===g.email)?.nickname||(g.email.endsWith("@local.aslung")?"":g.email)}</p></TableCell><TableCell>{g.grant_type==="lab"?<div><span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">🔄 動態繼承各設備在站期間</span><p className="text-[11px] text-slate-500 mt-0.5">開始與結束時間自動與各設備追蹤紀錄相同</p></div>:<>{localTime(g.start)}<br/>{g.end ? localTime(g.end) : "無限制"}</>}</TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>{setGrantType(g.grant_type==="lab"?"lab":"device");setGrantLab(g.lab_id||"");setGrantDevice(g.device_id||"");setGrantEmail(g.email);setGrantId(g.id);setModal("grant")}}>編輯</Button><Button size="sm" variant="ghost" aria-label="撤銷授權" onClick={()=>setConfirmation({action:"revoke",id:g.id,title:"刪除此筆授權紀錄？",description:"確認後該會員將失去此紀錄區間的存取權限。"})}><Trash2 size={15}/></Button></div></TableCell></TableRow>)}</TableBody></Table>}</section>
  </div>}
 {section==="connection"&&<div className="space-y-6">
  <div className={cn("grid gap-6", admin ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1")}>
    {admin&&<section className="panel p-7"><div className="section-icon"><Server/></div><h2>{isEn ? "EC2 MySQL Direct Connection" : "MySQL 資料庫直連狀態"}</h2><p className="text-muted-foreground mt-2">{isEn ? "Direct high-speed connection configured to the rcec_lung database on EC2." : "本系統已設定為直接連線至 EC2 的 rcec_lung 資料庫。"}</p><div className="connection-state"><CheckCircle2 size={20} style={{color:"#10b981"}}/><div><strong>{isEn ? "Direct Connection Active" : "已成功設定直連"}</strong><p>{isEn ? "High-performance paginated queries directly executed on rawdata table." : "系統直接對 rawdata 表格進行高效能分頁查詢。"}</p></div></div><h3 className="mt-6 mb-3 font-semibold text-sm">{isEn ? "Current Configuration" : "目前的對應設定"}</h3><ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground"><li>{isEn ? "Host: 35.160.61.178" : "主機：35.160.61.178"}</li><li>{isEn ? "Table: rcec_lung.rawdata" : "資料表：rcec_lung.rawdata"}</li><li>{isEn ? "Timezone Base: Read as UTC+0 and transformed" : "時間基準：以 UTC+0 讀取並轉換"}</li><li>{isEn ? "Permission Control: Strict member authorization enforcement" : "權限控制：強制套用本系統的會員授權區間"}</li></ul></section>}
    <section className="panel p-7"><div className="section-icon"><Key/></div><div className="flex items-center justify-between gap-4"><div><h2>{isEn ? "My API Access Tokens" : "我的 API 存取權杖"}</h2><p className="text-muted-foreground mt-2">{isEn ? <>Include <code>Authorization: Bearer &lt;TOKEN&gt;</code> in your HTTP request headers to authenticate and download data.</> : <>在您的外部程式 HTTP Request 標頭加入 <code>Authorization: Bearer &lt;TOKEN&gt;</code> 即可認證身分並下載資料。</>}</p></div><Button onClick={()=>setConfirmation({action:"tokenCreate",title:isEn ? "Generate Token?" : "產生新權杖？",description:isEn ? "Generate a random token for your scripts or applications." : "將產生一組隨機的新權杖供您的應用程式使用。"})}>{isEn ? "Generate Token" : "產生權杖"}</Button></div><div className="mt-6"><Table><TableHeader><TableRow><TableHead>{isEn ? "Token" : "Token 字串"}</TableHead><TableHead>{isEn ? "Created At" : "建立時間"}</TableHead><TableHead>{isEn ? "Actions" : "操作"}</TableHead></TableRow></TableHeader><TableBody>{tokens.map(t=><TableRow key={t.id}><TableCell className="mono font-semibold">{t.id}</TableCell><TableCell>{localTime(t.created_at)}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={()=>setConfirmation({action:"tokenDelete",id:t.id,title:isEn ? "Delete Token?" : "刪除此權杖？",description:isEn ? "All applications using this token will lose access immediately. Confirm?" : "所有正在使用此權杖的程式將立即無法連線。確認？"})}><Trash2 size={15}/></Button></TableCell></TableRow>)}{!tokens.length&&<TableRow><TableCell colSpan={3} className="text-center text-muted-foreground h-20">{isEn ? "No API tokens generated yet" : "尚未產生任何 API 權杖"}</TableCell></TableRow>}</TableBody></Table></div></section>
  </div>
  <ApiDocsView initialLang={isEn ? "en" : "zh"} />
</div>}
 </>}
 <footer className="workspace-footer"><span>ASLUNG · 資料管理平台</span><span className="flex items-center gap-1.5"><Eye size={12} className="text-teal-600"/> 網站瀏覽次數：<strong>{(state?.siteStats?.totalViews ?? 0).toLocaleString()}</strong> 次<span className="text-slate-400 font-normal">（今日 <strong>{state?.siteStats?.todayViews ?? 0}</strong> 次）</span></span><span><ShieldCheck size={13}/> 伺服器端權限驗證</span></footer></div></main>
 {(modal==="locationSync"||modal==="locationImport")&&<DeviceImportWizard key={modal} mode={modal==="locationSync"?"google":"paste"} initialText={fleetImportText} api={request} onReload={load} onClose={()=>{setModal("");setFleetImportText("");}}/>}
 <Dialog open={!!modal&&modal!=="locationSync"&&modal!=="locationImport"} onOpenChange={v=>{if(!busy&&!v)setModal("")}}>
  {modal&&<DialogContent className="bg-white sm:max-w-lg max-h-[88vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>
        {modal==="device" ? (editDevice?"編輯 ASLUNG ID":"建立 ASLUNG ID")
        : modal==="deviceQr" ? "設備 QR Code 標籤"
        : modal==="transfer" ? "移轉設備位置" : modal==="transferBulk" ? "大量移轉設備位置" : modal==="qrScanner" ? "掃描 ASLUNG ID QR Code"
        : modal==="importCsv" ? "大量匯入 CSV"
        : modal==="profile" ? (isEn?"My collaboration profile":"我的合作資料")
        : modal==="member" ? (editMember ? "編輯會員" : "新增會員")
        : modal==="fileUpload" ? "上傳新檔案並指定授權" : modal==="fileGrant" ? "設定檔案授權成員" : modal==="locationSync" ? "同步 Google 試算表設備追蹤" : modal==="locationImport" ? "匯入 / 貼上設備追蹤紀錄" : modal==="location" ? (editLocation ? "編輯位置紀錄" : "新增位置紀錄")
        : modal==="lab" ? (editLab ? "編輯地點 (Lab ID)" : "建立新地點 (Lab ID)")
        : modal==="labSync" ? "同步 Google 試算表地點庫 (Lab ID)"
        : modal==="maintainer" ? (editMaintainer ? "編輯維護人員" : "新增維護人員")
        : modal==="maintainerSync" ? "同步 Google 試算表維護人員名單"
        : modal==="alertSettings" ? "斷線告警監控與郵件設定"
        : modal==="requestGrant" ? (isEn ? "Request Device Data Access" : "申請設備資料授權")
        : modal==="reviewGrant" ? "審核設備授權申請"
        : modal==="password" ? "變更密碼"
        : grantId ? "編輯資料授權紀錄" : "新增資料授權紀錄"}
      </DialogTitle>
      <DialogDescription>
        {modal==="device" ? "ID 應與 EC2 資料來源的設備識別碼一致，系統將自動生成設備 QR Code 標籤。"
        : modal==="deviceQr" ? "包含 ASLUNG ID 設備編號的實體標籤，可直接下載 PNG 圖檔或列印貼在設備上。"
        : modal==="profile" ? (isEn?"Update your country, institution and collaboration project. Data permissions are assigned by the administrator.":"補填國家、機構與合作計畫；資料存取權限由管理員另行設定。")
        : modal==="member" ? (editMember ? "修改會員的基本資料與登入密碼。" : "設定會員帳號與初始密碼；會員登入後可變更密碼。")
        : modal==="fileUpload" ? "上傳檔案至系統，並指定特定會員可檢視與下載。" : modal==="fileGrant" ? "勾選授權可檢視與下載此檔案的會員清單。" : modal==="locationSync" ? "直接從線上 Google 試算表同步設備擺放位置與歷史紀錄，自動保留手動新增的紀錄。" : modal==="locationImport" ? "支援直接複製貼上 Google 試算表表格，或上傳 CSV 檔案批次匯入。" : modal==="location" ? "記錄設備（包含國外站點）目前的擺放位置與期間。"
        : modal==="lab" ? "設定實驗室或站點的代碼、縣市、區鄉鎮與座標資料。"
        : modal==="labSync" ? "直接從 Google 試算表 (gid=1071144150) 同步地點庫資料，自動更新現有紀錄。"
        : modal==="maintainer" ? "維護人員姓名將與設備追蹤之負責人欄位自動關聯。"
        : modal==="maintainerSync" ? "直接從 Google 試算表 (gid=603688252) 同步維護人員聯絡資料。"
        : modal==="alertSettings" ? "設定每隔多久檢查一次設備斷線狀況，以及寄送告警的斷線門檻與 SMTP 伺服器。"
        : modal==="requestGrant" ? (isEn ? "Enter the ASLUNG ID and purpose to request data access. Once approved by the administrator, you can query and download data." : "輸入欲申請存取的 ASLUNG ID 與說明，管理員核准後即可查詢與下載該設備數據。")
        : modal==="reviewGrant" ? "確認並指定核准開通的資料存取期間，完成後會員即可立即查詢該設備。"
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
          void mutate({action:"grant",id:grantId,grantType,deviceId:grantType==="device"?grantDevice:null,labId:grantType==="lab"?grantLab:null,email:grantEmail,start:zoned(String(p.start)),end:p.end?zoned(String(p.end)):null});
        }else if(modal==="labSync"){
          setBusy(true);
          void request("/api/manage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"labSyncGoogle",url:p.url})}).then(async res=>{await load();setModal("");toast.success(`同步成功！共更新 ${res.synced||0} 筆地點資料`);}).catch(e=>toast.error((e as Error).message)).finally(()=>setBusy(false));
        }else if(modal==="maintainerSync"){
          setBusy(true);
          void request("/api/manage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"maintainerSyncGoogle",url:p.url})}).then(async res=>{await load();setModal("");toast.success(`同步成功！共更新 ${res.synced||0} 位維護人員資料`);}).catch(e=>toast.error((e as Error).message)).finally(()=>setBusy(false));
        }else if(modal==="lab"){
          void mutate({action:"lab",...p});
        }else if(modal==="maintainer"){
          void mutate({action:"maintainer",...p});
        }else if(modal==="alertSettings"){
          void mutate({action:"alertSettingsUpdate",...p,enabled:p.enabled==="1"?1:0,use_test_email:p.use_test_email==="1"?1:0});
        }else if(modal==="location"){
          void mutate({action: editLocation ? "locationUpdate" : "locationAdd", id: editLocation?.id, ...p, startTime:zoned(String(p.startTime)), endTime:p.endTime?zoned(String(p.endTime)):null});
        }else if(modal==="importCsv"){
          const text=String(p.csvText||"").trim();
          if(!text)throw new Error("請貼上資料");
          void parseAndImportCsv(text);
        }else if (modal==="transferBulk"){ void mutate({action:"transferBulk", aslungIds: Array.from(selectedDevices), labId: String(p.labId)}).then(() => setSelectedDevices(new Set())); }else if (modal==="transfer"){
          void (async()=>{
            if(await mutate({action:"transfer",...p})){
              if(confirm("移轉成功！\n\n是否結束該設備先前的資料授權？\n(若點選「確定」，原授權將結算至現在，並會引導您設定新授權。若點選「取消」則繼續沿用原授權)")){
                if(await mutate({action:"endGrants",aslungId:String(p.aslungId)})){
                  setGrantType("device");setGrantDevice(String(p.aslungId));setGrantLab("");setGrantEmail("");setGrantId(null);setModal("grant");
                }
              }
            }
          })();
        } else if (modal === "profile") {
          void mutate({action:"profileUpdate",...p});
        } else if (modal === "member" && editMember) {
          void mutate({action:"memberEdit", ...p});
        } else if (modal === "fileUpload") {
          const fileInput = e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement;
          const file = fileInput?.files?.[0];
          if (!file) throw new Error("請選擇要上傳的檔案。");
          const formData = new FormData();
          formData.append("file", file);
          formData.append("description", String(p.description || ""));
          formData.append("emails", JSON.stringify(Array.from(uploadEmails)));
          setBusy(true);
          void request("/api/files", {
            method: "POST",
            body: formData,
          }).then(async () => {
            await load();
            setModal("");
            toast.success("檔案上傳成功！");
          }).catch(e => toast.error((e as Error).message)).finally(() => setBusy(false));
        } else if (modal === "fileGrant") {
          if (!selectedFile) return;
          void mutate({action: "fileGrantsUpdate", fileId: selectedFile.id, emails: Array.from(fileGrantEmails)});
        } else if (modal === "device") { const newStatus = String(p.status || "DEPLOYED"); const devId = String(p.id); setState(prev => prev ? { ...prev, devices: prev.devices.some(d => d.id === devId) ? prev.devices.map(d => d.id === devId ? { ...d, status: newStatus, description: String(p.description || "") } : d) : [...prev.devices, { id: devId, name: "", location: String(p.labId || ""), description: String(p.description || ""), status: newStatus }] } : prev); void mutate({ action: "device", ...p }); } else if (modal === "requestGrant") {
          const reqType = requestType;
          const aslungId = String(p.aslungId || "").trim();
          const labId = String(p.labId || requestLabId || "").trim();
          const reason = String(p.reason || "").trim();
          if (reqType === "lab" && !labId) throw new Error("請選擇欲申請的地點 (Lab ID)。");
          if (reqType === "device" && !aslungId) throw new Error("請輸入欲申請的 ASLUNG ID。");
          void mutate({ action: "requestGrant", requestType: reqType, aslungId, labId, reason }).then(ok => {
            if (ok) {
              setRequestAslungId("");
              setRequestLabId("");
              setRequestReason("");
              setModal("");
              toast.success("授權申請已送出！請等待管理員審核。");
            }
          });
        } else if (modal === "reviewGrant") {
          const reqId = Number(p.id);
          const decision = String(p.decision || "APPROVED");
          const startTime = p.start ? zoned(String(p.start)) : null;
          const endTime = p.end ? zoned(String(p.end)) : null;
          void mutate({ action: "reviewGrantRequest", id: reqId, decision, start: startTime, end: endTime }).then(ok => {
            if (ok) {
              setModal("");
              setReviewRequest(null);
              toast.success(decision === "APPROVED" ? "已核准申請並開通設備授權！" : "已拒絕該申請。");
            }
          });
        } else {
          void mutate({action:modal,...p});
        }
      }catch(e){
        toast.error((e as Error).message);
      }
    }}>
      <datalist id="lab-datalist">{labs.map(l=><option key={l.id} value={l.id}>{[l.city_name,l.town_name,l.location_name].filter(Boolean).join(" ")}</option>)}</datalist>
      <datalist id="maintainer-datalist">{maintainers.map(m=><option key={m.name} value={m.name}>{m.email}</option>)}</datalist>
      {modal==="device"?<>
        <Label htmlFor="device-id">ASLUNG ID</Label>
        <Input id="device-id" name="id" required maxLength={80} placeholder="例如 ASLUNG_001" pattern="[A-Za-z0-9_-]+" defaultValue={editDevice?.id||liveQrId||""} readOnly={!!editDevice} onChange={e=>setLiveQrId(e.target.value.trim())}/>
        <Label htmlFor="status">設備狀態</Label><select id="status" name="status" className="w-full h-11 border px-3 rounded-md bg-white" defaultValue={editDevice?.status||"DEPLOYED"} onChange={e=>{const labIn=document.getElementById("lab-id-device") as HTMLInputElement;if(labIn&&(e.target.value==="STANDBY"||e.target.value==="MAINTENANCE"||e.target.value==="RETIRED"||e.target.value==="LOST"))labIn.value="";}}><option value="DEPLOYED">使用中 (Deployed)</option><option value="STANDBY">待命中 (Standby)</option><option value="MAINTENANCE">維修中 (Maintenance)</option><option value="RETIRED">已報廢 (Retired)</option><option value="LOST">遺失 (Lost)</option></select><Label htmlFor="lab-id-device">目前位置 / 實驗室</Label>
        <Input id="lab-id-device" name="labId" list="lab-datalist" maxLength={160} placeholder="例如：國外實驗室 A" defaultValue={editDevice ? (currentDeployments.get(editDevice.id)?.lab_id || "") : ""}/>
        <Label htmlFor="description">備註</Label>
        <Textarea id="description" name="description" maxLength={1000} placeholder="選填" defaultValue={editDevice?.description||""}/>
        <div className="mt-4 p-4 border rounded-lg bg-slate-50 flex flex-col items-center">
          <div className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5"><QrCode size={14}/> 自動生成 QR Code 設備標籤預覽</div>
          {liveQrUrl ? (
            <div className="flex flex-col items-center gap-2">
              <img src={liveQrUrl} alt="QR Code Label" className="w-44 h-auto rounded border shadow-sm bg-white" />
              <div className="flex gap-2 mt-1">
                <Button type="button" size="xs" variant="outline" onClick={()=>{const a=document.createElement("a");a.href=liveQrUrl;a.download=`ASLUNG_${liveQrId||editDevice?.id}_QR.png`;a.click();}}><Download size={13} className="mr-1"/>下載標籤圖檔</Button>
                <Button type="button" size="xs" variant="outline" onClick={()=>printQrLabel(liveQrUrl, liveQrId||editDevice?.id)}>列印標籤</Button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 py-4">請在上方輸入 ASLUNG ID，系統將自動生成 QR Code 標籤</div>
          )}
        </div>
      </> : modal==="deviceQr"?<>
        <div className="flex flex-col items-center justify-center p-2">
          {viewQrUrl ? (
            <>
              <img src={viewQrUrl} alt={qrDevice?.id} className="w-52 h-auto rounded-lg border shadow-md bg-white mb-3" />
              <div className="text-center mb-4">
                <p className="text-lg font-bold mono text-slate-800 tracking-wide">{qrDevice?.id}</p><p className="text-xs text-blue-600 font-mono mt-0.5 break-all">{typeof window !== "undefined" ? `${window.location.origin}/?id=${qrDevice?.id}` : ""}</p>
                <p className="text-xs text-slate-500 mt-1">
                  目前位置：{(() => { const activeLoc = locations.find(l=>l.aslung_id===qrDevice?.id&&l.active&&!l.end_time); if (activeLoc) return activeLoc.lab_id; const locName = qrDevice?.location || locations.find(l=>l.aslung_id===qrDevice?.id)?.lab_id; return locName ? `${locName} (前次)` : "無"; })()} · 狀態：{qrDevice?.status === "DEPLOYED" ? "使用中" : qrDevice?.status === "STANDBY" ? "待命中" : qrDevice?.status === "MAINTENANCE" ? "維修中" : qrDevice?.status === "RETIRED" ? "已報廢" : "遺失"}
                </p>
                {qrDevice?.description && <p className="text-xs text-slate-400 mt-0.5">{qrDevice.description}</p>}
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={()=>{const a=document.createElement("a");a.href=viewQrUrl;a.download=`ASLUNG_${qrDevice?.id}_QR.png`;a.click();}}><Download size={15} className="mr-1.5"/>下載 PNG 圖檔</Button>
                <Button type="button" onClick={()=>printQrLabel(viewQrUrl, qrDevice?.id)}>列印標籤貼紙</Button>
              </div>
            </>
          ) : (
            <div className="py-12 text-slate-400 text-sm">正在生成 QR Code…</div>
          )}
        </div>
      </> : modal==="transfer"?<>
        <div className="mb-4 text-sm text-slate-600">設備 <strong className="mono">{transferDevice?.id}</strong> 將移轉至新位置，系統會自動結算當前位置的紀錄並建立新紀錄。</div>
        <input type="hidden" name="aslungId" value={transferDevice?.id||""} />
        <Label htmlFor="lab-id">新位置 / 實驗室名稱</Label>
        <Input id="lab-id" name="labId" list="lab-datalist" required maxLength={160} placeholder="例如：國外實驗室 A" />
      
      </> : modal==="transferBulk"?<>
        <div className="mb-4 text-sm text-slate-600">將 <strong>{selectedDevices.size}</strong> 台設備移轉至新位置。</div>
        <Label htmlFor="lab-id-bulk">新位置 / 實驗室名稱</Label>
        <Input id="lab-id-bulk" name="labId" list="lab-datalist" required maxLength={160} placeholder="例如：國外實驗室 A" />
      </> : modal==="qrScanner"?<>
        <div id="reader" className="w-full overflow-hidden rounded-md bg-slate-100 min-h-[300px]"></div>
        <p className="text-center text-sm text-slate-500 mt-4">請將相機對準設備的 QR Code</p>
      </> : modal==="profile"?<MemberProfileFields profile={state?.me} isEnglish={isEn}/> : modal==="member"?<>

        {editMember && <input type="hidden" name="originalEmail" value={editMember.email} />}
        <Label htmlFor="member-name">會員姓名</Label>
        <Input id="member-name" name="name" required maxLength={160} defaultValue={editMember?.name||""}/>
        <Label htmlFor="member-nickname">會員帳號 (暱稱)</Label>
        <Input id="member-nickname" name="nickname" required maxLength={80} placeholder="例如：user123" pattern="[A-Za-z0-9_\\-]+" defaultValue={editMember?.nickname||""}/>
        <Label htmlFor="email">Email (選填)</Label>
        <Input id="email" name="email" type="email" maxLength={254} defaultValue={editMember?.email?.endsWith("@local.aslung") ? "" : editMember?.email||""}/>
        <Label htmlFor="initial-password">{editMember ? "新密碼 (若不修改請留空，至少 12 字元)" : "初始密碼（至少 12 字元）"}</Label>
        <Input id="initial-password" name="password" type="password" autoComplete="new-password" required={!editMember} minLength={12} maxLength={128}/>
        <MemberProfileFields profile={editMember||{}} isEnglish={isEn}/>
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
            </> : modal==="fileUpload"?<>
        <Label htmlFor="upload-file">選擇檔案</Label>
        <Input id="upload-file" name="file" type="file" required className="cursor-pointer bg-white" />
        <Label htmlFor="upload-desc">檔案說明 / 備註 (選填)</Label>
        <Textarea id="upload-desc" name="description" placeholder="例如：2025 年泰國站點監測校正報告書" rows={2} />
        <div className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <Label className="font-semibold text-slate-800">指派授權成員 (可多選)：</Label>
            <div className="flex gap-2">
              <Button type="button" size="xs" variant="outline" onClick={() => {
                const memberEmails = members.filter(m => m.role === "member" && m.active).map(m => m.email);
                setUploadEmails(new Set(memberEmails));
              }}>全選一般會員</Button>
              <Button type="button" size="xs" variant="outline" onClick={() => setUploadEmails(new Set())}>全部清除</Button>
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto border rounded-md p-2.5 space-y-1.5 bg-slate-50">
            {members.filter(m => m.role === "member" && m.active).map(m => (
              <label key={m.email} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white p-1 rounded transition-colors">
                <input
                  type="checkbox"
                  checked={uploadEmails.has(m.email)}
                  onChange={e => {
                    const s = new Set(uploadEmails);
                    if (e.target.checked) s.add(m.email);
                    else s.delete(m.email);
                    setUploadEmails(s);
                  }}
                />
                <span className="font-medium text-slate-800">{m.name}</span>
                <span className="text-xs text-slate-400">({m.nickname || (m.email.endsWith("@local.aslung") ? "無暱稱" : m.email)})</span>
              </label>
            ))}
            {members.filter(m => m.role === "member" && m.active).length === 0 && (
              <p className="text-xs text-slate-400 py-2 text-center">目前無有效一般會員</p>
            )}
          </div>
        </div>
      </> : modal==="fileGrant"?<>
        <div className="bg-slate-50 p-3 rounded-lg border mb-3">
          <p className="text-xs text-slate-500">目前檔案</p>
          <p className="text-sm font-semibold text-slate-800 mt-0.5">{selectedFile?.name}</p>
          {selectedFile?.description && <p className="text-xs text-slate-500 mt-1">{selectedFile.description}</p>}
        </div>
        <div className="flex items-center justify-between mb-2">
          <Label className="font-semibold text-slate-800">指派可檢視與下載的會員：</Label>
          <div className="flex gap-2">
            <Button type="button" size="xs" variant="outline" onClick={() => {
              const memberEmails = members.filter(m => m.role === "member" && m.active).map(m => m.email);
              setFileGrantEmails(new Set(memberEmails));
            }}>全選一般會員</Button>
            <Button type="button" size="xs" variant="outline" onClick={() => setFileGrantEmails(new Set())}>全部清除</Button>
          </div>
        </div>
        <div className="max-h-52 overflow-y-auto border rounded-md p-2.5 space-y-1.5 bg-slate-50">
          {members.filter(m => m.role === "member" && m.active).map(m => (
            <label key={m.email} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white p-1 rounded transition-colors">
              <input
                type="checkbox"
                checked={fileGrantEmails.has(m.email)}
                onChange={e => {
                  const s = new Set(fileGrantEmails);
                  if (e.target.checked) s.add(m.email);
                  else s.delete(m.email);
                  setFileGrantEmails(s);
                }}
              />
              <span className="font-medium text-slate-800">{m.name}</span>
              <span className="text-xs text-slate-400">({m.nickname || (m.email.endsWith("@local.aslung") ? "無暱稱" : m.email)})</span>
            </label>
          ))}
          {members.filter(m => m.role === "member" && m.active).length === 0 && (
            <p className="text-xs text-slate-400 py-2 text-center">目前無有效一般會員</p>
          )}
        </div>
      </> : modal==="location"?<>
        {editLocation && <input type="hidden" name="id" value={editLocation.id}/>}
        <Label htmlFor="lab-id">Lab ID / 擺放地點</Label>
        <Input id="lab-id" name="labId" list="lab-datalist" required maxLength={160} placeholder="例如 國外實驗室 A" defaultValue={editLocation?.lab_id||""}/>
        <Label htmlFor="maintainer">負責人 / 維護者 (選填)</Label>
        <Input id="maintainer" name="maintainer" list="maintainer-datalist" maxLength={80} placeholder="例如：張喻翔、劉純湖" defaultValue={editLocation?.maintainer||""}/>
        <Label htmlFor="aslung-id-sel">ASLUNG ID</Label>
        <select id="aslung-id-sel" name="aslungId" className="w-full h-11 border px-3 rounded-md bg-white" required defaultValue={editLocation?.aslung_id||""}><option value="">選擇設備</option>{devices.map(d=><option key={d.id} value={d.id}>{d.id} · {d.name}</option>)}</select>
        <Label htmlFor="loc-start">開始時間 ({tz})</Label>
        <Input id="loc-start" name="startTime" type="datetime-local" defaultValue={editLocation?.start_time ? formatInTimeZone(new Date(editLocation.start_time), tz, "yyyy-MM-dd'T'HH:mm") : today()+"T00:00"} required/>
        <Label htmlFor="loc-end">結束時間 ({tz})</Label>
        <Input id="loc-end" name="endTime" type="datetime-local" defaultValue={editLocation?.end_time ? formatInTimeZone(new Date(editLocation.end_time), tz, "yyyy-MM-dd'T'HH:mm") : ""} />
        <Label className="flex items-center gap-2 mt-4"><input type="checkbox" name="active" value="1" defaultChecked={editLocation ? !!editLocation.active : true} /> 目前在此位置 (Active)</Label>
      </> : modal==="lab"?<>
        <Label htmlFor="lab-id-field">Lab ID (地點識別碼)</Label>
        <Input id="lab-id-field" name="id" required maxLength={80} placeholder="例如：ASLUNG_LAB_01" defaultValue={editLab?.id||""} readOnly={!!editLab}/>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div>
            <Label htmlFor="city-name">縣市名稱</Label>
            <Input id="city-name" name="city_name" placeholder="例如：台北市" defaultValue={editLab?.city_name||""}/>
          </div>
          <div>
            <Label htmlFor="town-name">鄉鎮市區</Label>
            <Input id="town-name" name="town_name" placeholder="例如：南港區" defaultValue={editLab?.town_name||""}/>
          </div>
        </div>
        <Label htmlFor="loc-name" className="mt-2">地點名稱</Label>
        <Input id="loc-name" name="location_name" placeholder="例如：中研院環境變遷中心" defaultValue={editLab?.location_name||""}/>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div>
            <Label htmlFor="lab-lat">緯度 (Lat)</Label>
            <Input id="lab-lat" name="lat" type="number" step="any" placeholder="例如：25.0421" defaultValue={editLab?.lat ?? ""}/>
          </div>
          <div>
            <Label htmlFor="lab-lon">經度 (Lon)</Label>
            <Input id="lab-lon" name="lon" type="number" step="any" placeholder="例如：121.6145" defaultValue={editLab?.lon ?? ""}/>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div>
            <Label htmlFor="lab-height">高度</Label>
            <Input id="lab-height" name="height" placeholder="例如：15m" defaultValue={editLab?.height||""}/>
          </div>
          <div>
            <Label htmlFor="lab-source">資料來源</Label>
            <Input id="lab-source" name="source" placeholder="例如：ASLUNG" defaultValue={editLab?.source||""}/>
          </div>
        </div>
        <Label htmlFor="lab-cmd" className="mt-2">指令 / 備註</Label>
        <Input id="lab-cmd" name="command" placeholder="選填" defaultValue={editLab?.command||""}/>
        <Label htmlFor="lab-desc" className="mt-2">說明 / 備註</Label>
        <Textarea id="lab-desc" name="description" placeholder="詳細地點資訊或說明..." rows={2} defaultValue={editLab?.description||""}/>
      </> : modal==="labSync"?<>
        <div className="bg-emerald-50/80 p-3.5 rounded-lg border border-emerald-200 mb-4 text-xs text-emerald-800 space-y-1.5">
          <p className="font-semibold text-emerald-900 flex items-center gap-1.5"><CloudDownload size={14}/> Google 試算表地點庫同步：</p>
          <p>• 系統將直接下載線上試算表並自動更新地點庫 (Lab ID, 縣市, 鄉鎮, 地點名稱, 經緯度等)。</p>
          <p>• 採用 UPSERT 機制：相同 Lab ID 將自動更新，新 Lab ID 將自動新增。</p>
        </div>
        <Label htmlFor="lab-sync-url">Google 試算表網址 (gid=1071144150)</Label>
        <Input id="lab-sync-url" name="url" required defaultValue="https://docs.google.com/spreadsheets/d/1Vzaz14hHco2u8nmjoKBqDC12k-OX6lMjyrP_UhAhZrI/edit?gid=1071144150#gid=1071144150"/>
      </> : modal==="maintainer"?<>
        <Label htmlFor="m-name">維護人員姓名</Label>
        <Input id="m-name" name="name" required maxLength={80} placeholder="例如：張喻翔" defaultValue={editMaintainer?.name||""} readOnly={!!editMaintainer}/>
        <Label htmlFor="m-email" className="mt-2">主要聯絡 Email (告警通知寄送)</Label>
        <Input id="m-email" name="email" type="email" required maxLength={160} placeholder="例如：maintainer@example.com" defaultValue={editMaintainer?.email||""}/>
        <Label htmlFor="m-email-test" className="mt-2">測試用 Email (選填)</Label>
        <Input id="m-email-test" name="email_test" type="email" maxLength={160} placeholder="選填，可用於測試模式" defaultValue={editMaintainer?.email_test||""}/>
        <Label htmlFor="m-phone" className="mt-2">聯絡電話 (選填)</Label>
        <Input id="m-phone" name="phone" maxLength={50} placeholder="例如：0912-345-678" defaultValue={editMaintainer?.phone||""}/>
        <Label htmlFor="m-notes" className="mt-2">備註 (選填)</Label>
        <Textarea id="m-notes" name="notes" placeholder="負責區域或備註事項..." rows={2} defaultValue={editMaintainer?.notes||""}/>
      </> : modal==="maintainerSync"?<>
        <div className="bg-emerald-50/80 p-3.5 rounded-lg border border-emerald-200 mb-4 text-xs text-emerald-800 space-y-1.5">
          <p className="font-semibold text-emerald-900 flex items-center gap-1.5"><CloudDownload size={14}/> Google 試算表維護人員同步：</p>
          <p>• 系統將直接下載線上試算表並同步維護人員姓名、聯絡信箱 (mail) 與測試信箱 (mail_test)。</p>
          <p>• 姓名將自動與設備追蹤之「負責人 / 維護者」欄位產生關聯，斷線時自動寄送告警通知信。</p>
        </div>
        <Label htmlFor="m-sync-url">Google 試算表網址 (gid=603688252)</Label>
        <Input id="m-sync-url" name="url" required defaultValue="https://docs.google.com/spreadsheets/d/1Vzaz14hHco2u8nmjoKBqDC12k-OX6lMjyrP_UhAhZrI/edit?gid=603688252#gid=603688252"/>
      </> : modal==="alertSettings"?<>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
            <input type="checkbox" name="enabled" value="1" defaultChecked={alertSettings?.enabled !== 0} />
            啟用背景定時監控與離線告警發送
          </label>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Clock size={14} className="text-teal-600" /> 檢查排程頻率設定
              </span>
              <span className="text-[11px] text-slate-400">時區：{tz}</span>
            </div>

            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-200/70 rounded-lg text-xs font-medium">
              <button
                type="button"
                onClick={() => setAlertScheduleType("interval")}
                className={`py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 ${
                  alertScheduleType === "interval"
                    ? "bg-white text-teal-800 font-semibold shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>⏱️</span> 固定間隔
              </button>
              <button
                type="button"
                onClick={() => setAlertScheduleType("daily")}
                className={`py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 ${
                  alertScheduleType === "daily"
                    ? "bg-white text-teal-800 font-semibold shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>📅</span> 每天固定時間
              </button>
              <button
                type="button"
                onClick={() => setAlertScheduleType("weekly")}
                className={`py-1.5 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 ${
                  alertScheduleType === "weekly"
                    ? "bg-white text-teal-800 font-semibold shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span>📆</span> 每週固定時間
              </button>
            </div>

            <input type="hidden" name="schedule_type" value={alertScheduleType} />

            {/* 模式 1: 固定間隔 */}
            {alertScheduleType === "interval" && (
              <div className="bg-white p-3 rounded-md border border-slate-200 space-y-1">
                <input type="hidden" name="schedule_time" value={alertSettings?.schedule_time || "09:00"} />
                <input type="hidden" name="schedule_days" value={alertSettings?.schedule_days || "1,2,3,4,5"} />
                <Label htmlFor="check-interval" className="text-xs">檢查間隔 (分鐘)</Label>
                <Input
                  id="check-interval"
                  name="check_interval_mins"
                  type="number"
                  min={5}
                  defaultValue={alertSettings?.check_interval_mins || 60}
                  required
                />
                <p className="text-[11px] text-slate-400">以固定頻率持續檢查所有設備狀態（建議每 30～60 分鐘一次）</p>
              </div>
            )}

            {/* 模式 2: 每天固定時間 */}
            {alertScheduleType === "daily" && (
              <div className="bg-white p-3 rounded-md border border-slate-200 space-y-1">
                <input type="hidden" name="check_interval_mins" value={alertSettings?.check_interval_mins || 60} />
                <input type="hidden" name="schedule_days" value={alertSettings?.schedule_days || "1,2,3,4,5"} />
                <Label htmlFor="schedule-time-daily" className="text-xs">每日執行檢查時間 ({tz})</Label>
                <Input
                  id="schedule-time-daily"
                  name="schedule_time"
                  type="time"
                  defaultValue={alertSettings?.schedule_time || "09:00"}
                  required
                />
                <p className="text-[11px] text-slate-400">每天到達指定時間時自動檢查設備斷線狀況並發送信件（當天不重複發送）</p>
              </div>
            )}

            {/* 模式 3: 每週固定時間 */}
            {alertScheduleType === "weekly" && (
              <div className="bg-white p-3 rounded-md border border-slate-200 space-y-2.5">
                <input type="hidden" name="check_interval_mins" value={alertSettings?.check_interval_mins || 60} />
                <input type="hidden" name="schedule_days" value={alertScheduleDays} />

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-xs">每週檢查星期 (可多選)：</Label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setAlertScheduleDays("1,2,3,4,5")}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                      >
                        週一至五
                      </button>
                      <button
                        type="button"
                        onClick={() => setAlertScheduleDays("1,2,3,4,5,6,0")}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                      >
                        每天
                      </button>
                      <button
                        type="button"
                        onClick={() => setAlertScheduleDays("6,0")}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                      >
                        週末
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {[
                      { d: "1", label: "週一" },
                      { d: "2", label: "週二" },
                      { d: "3", label: "週三" },
                      { d: "4", label: "週四" },
                      { d: "5", label: "週五" },
                      { d: "6", label: "週六" },
                      { d: "0", label: "週日" },
                    ].map(item => {
                      const isSelected = alertScheduleDays.split(",").map(x => x.trim()).includes(item.d);
                      return (
                        <button
                          key={item.d}
                          type="button"
                          onClick={() => {
                            const cur = alertScheduleDays.split(",").map(x => x.trim()).filter(Boolean);
                            let next;
                            if (cur.includes(item.d)) {
                              next = cur.filter(x => x !== item.d);
                              if (next.length === 0) next = [item.d];
                            } else {
                              next = [...cur, item.d];
                            }
                            const order = ["1", "2", "3", "4", "5", "6", "0"];
                            next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
                            setAlertScheduleDays(next.join(","));
                          }}
                          className={`py-1.5 rounded text-xs font-semibold border transition-all ${
                            isSelected
                              ? "bg-teal-600 text-white border-teal-700 shadow-xs"
                              : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label htmlFor="schedule-time-weekly" className="text-xs">執行檢查時間 ({tz})</Label>
                  <Input
                    id="schedule-time-weekly"
                    name="schedule_time"
                    type="time"
                    defaultValue={alertSettings?.schedule_time || "09:00"}
                    required
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    在所選的星期到達此時間時自動執行斷線檢查（已選：{
                      alertScheduleDays.split(",").map(x => {
                        const m: Record<string, string> = { "1": "一", "2": "二", "3": "三", "4": "四", "5": "五", "6": "六", "0": "日" };
                        return m[x.trim()] || x;
                      }).join("、")
                    }）
                  </p>
                </div>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="offline-threshold">斷線判定門檻 (分鐘)</Label>
            <Input id="offline-threshold" name="offline_threshold_mins" type="number" min={5} defaultValue={alertSettings?.offline_threshold_mins || 60} required />
            <p className="text-[11px] text-slate-400 mt-1">超過此時間無數據即視為斷線 (預設 60 分鐘)</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" name="use_test_email" value="1" defaultChecked={!!alertSettings?.use_test_email} />
            優先發送至測試信箱 (mail_test)
          </label>
          <div className="border-t pt-3">
            <h4 className="text-xs font-bold text-slate-700 mb-2">SMTP 郵件伺服器設定 (選填)</h4>
            <p className="text-[11px] text-slate-400 mb-3">若未設定 SMTP，系統將以「模擬記錄模式」運作並完整記錄於告警日誌中。</p>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="col-span-2">
                <Label htmlFor="smtp-host" className="text-xs">SMTP 主機 (Host)</Label>
                <Input id="smtp-host" name="smtp_host" placeholder="例如：smtp.gmail.com" defaultValue={alertSettings?.smtp_host || ""} />
              </div>
              <div>
                <Label htmlFor="smtp-port" className="text-xs">連接埠 (Port)</Label>
                <Input id="smtp-port" name="smtp_port" type="number" placeholder="587" defaultValue={alertSettings?.smtp_port || 587} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <Label htmlFor="smtp-user" className="text-xs">帳號 (User)</Label>
                <Input id="smtp-user" name="smtp_user" placeholder="例如：alert@aslung.tw" defaultValue={alertSettings?.smtp_user || ""} />
              </div>
              <div>
                <Label htmlFor="smtp-pass" className="text-xs">密碼 (Password)</Label>
                <Input id="smtp-pass" name="smtp_pass" type="password" placeholder="若不修改請留空" />
              </div>
            </div>
            <div>
              <Label htmlFor="smtp-from" className="text-xs">發信人地址 (From Header)</Label>
              <Input id="smtp-from" name="smtp_from" placeholder="例如：ASLUNG 監測系統 <alert@aslung.tw>" defaultValue={alertSettings?.smtp_from || ""} />
            </div>
          </div>
        </div>
      </> : modal==="requestGrant"?<>
        <div className="bg-teal-50/80 p-3.5 rounded-lg border border-teal-200 mb-3 text-xs text-teal-900 space-y-1">
          <p className="font-semibold flex items-center gap-1.5"><ShieldCheck size={14}/> {isEn ? "Application Notes:" : "申請說明："}</p>
          <p>{isEn ? "• You can request batch access by Lab ID (all current & future devices at that site) or by individual ASLUNG ID." : "• 您可選擇按「地點 (Lab ID)」申請該站點全部設備（含未來新增設備），或按「個別設備 (ASLUNG ID)」申請。"}</p>
          <p>{isEn ? "• After submitting, the administrator will review your request. Once approved, you can view and download data here." : "• 送出後系統將通知管理員審核，核准後即可在此查詢與下載該站點或設備的監測數據。"}</p>
        </div>

        <div className="flex rounded-lg border border-slate-200 p-1 bg-slate-50 gap-1 mb-3">
          <button
            type="button"
            onClick={() => setRequestType("lab")}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              requestType === "lab"
                ? "bg-white text-blue-700 shadow-xs border border-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>📍 {isEn ? "By Lab ID (Location)" : "按地點申請 (Lab ID)"}</span>
            <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded font-normal">{isEn ? "Batch" : "批量授權"}</span>
          </button>
          <button
            type="button"
            onClick={() => setRequestType("device")}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              requestType === "device"
                ? "bg-white text-emerald-700 shadow-xs border border-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>📟 {isEn ? "By ASLUNG ID (Device)" : "按設備申請 (ASLUNG ID)"}</span>
            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-normal">{isEn ? "Single" : "單機"}</span>
          </button>
        </div>

        {requestType === "lab" ? (
          <div>
            <Label htmlFor="req-lab-id">{isEn ? "Select Location (Lab ID)" : "選擇地點 (Lab ID)"}</Label>
            {pick(
              requestLabId,
              setRequestLabId,
              labs.map(l => {
                const locName = [l.city_name, l.town_name, l.location_name].filter(Boolean).join(" ");
                return {
                  value: l.id,
                  label: `${l.id}${locName ? " · " + locName : ""}`
                };
              }),
              isEn ? "Select a location (Lab ID)" : "選擇要申請的地點 (Lab ID)"
            )}
            <input type="hidden" name="labId" value={requestLabId} />
            <p className="text-[11px] text-blue-600 mt-1">💡 核准後將可存取該站點所有現存與未來調入的設備量測資料。</p>
          </div>
        ) : (
          <div>
            <Label htmlFor="req-aslung-id">{isEn ? "ASLUNG ID (Device Identifier)" : "ASLUNG ID (設備編號)"}</Label>
            <Input
              id="req-aslung-id"
              name="aslungId"
              maxLength={80}
              placeholder={isEn ? "e.g., AL-0001" : "例如：AL-0001"}
              value={requestAslungId}
              onChange={e=>setRequestAslungId(e.target.value.toUpperCase())}
              className="font-mono uppercase font-semibold"
            />
          </div>
        )}

        <Label htmlFor="req-reason" className="mt-3">{isEn ? "Purpose / Reason (Optional)" : "申請事由 / 說明 (選填)"}</Label>
        <Textarea
          id="req-reason"
          name="reason"
          maxLength={500}
          placeholder={isEn ? "Briefly describe your research purpose or usage for faster review..." : "請簡述您的使用需求或研究用途，以利管理員快速審核..."}
          rows={3}
          value={requestReason}
          onChange={e=>setRequestReason(e.target.value)}
        />
        {grantRequests.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center justify-between">
              <span>{isEn ? `My Requests (${grantRequests.length})` : `我的申請紀錄 (${grantRequests.length})`}</span>
              <span className="text-[11px] text-slate-400 font-normal">{isEn ? "Ordered by submission time" : "依申請時間排序"}</span>
            </h4>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {grantRequests.map(gr => (
                <div key={gr.id} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {gr.request_type === "lab" ? (
                        <div className="flex items-center gap-1">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800 border border-blue-200">📍 地點</span>
                          <span className="font-mono font-bold text-blue-900">{gr.lab_id}</span>
                          <span className="text-[11px] text-slate-600 truncate">{[gr.city_name, gr.town_name, gr.location_name].filter(Boolean).join(" ")}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">📟 設備</span>
                          <span className="font-mono font-bold text-slate-800">{gr.aslung_id}</span>
                        </div>
                      )}
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${gr.status === "APPROVED" ? "bg-emerald-100 text-emerald-800 border border-emerald-300" : gr.status === "REJECTED" ? "bg-red-100 text-red-800 border border-red-300" : "bg-amber-100 text-amber-800 border border-amber-300"}`}>
                        {gr.status === "APPROVED" ? (isEn ? "Approved" : "已核准") : gr.status === "REJECTED" ? (isEn ? "Rejected" : "已拒絕") : (isEn ? "Pending" : "待審核")}
                      </span>
                    </div>
                    {gr.reason && <p className="text-slate-600 text-[11px] mt-0.5 truncate">{gr.reason}</p>}
                    <p className="text-slate-400 text-[10px] mt-0.5">{localTime(gr.created_at)}</p>
                  </div>
                  {gr.status === "PENDING" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-slate-400 hover:text-red-600 shrink-0"
                      title={isEn ? "Withdraw request" : "撤回申請"}
                      onClick={() => setConfirmation({ action: "grantRequestDelete", id: gr.id, title: isEn ? "Withdraw this request?" : "撤回此授權申請？", description: isEn ? `Are you sure you want to withdraw this request?` : `確定要撤回此筆授權申請？` })}
                    >
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </> : modal==="reviewGrant"?<>
        {reviewRequest && (
          <div className="space-y-3">
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">申請會員：</span>
                <span className="font-bold text-slate-800">{reviewRequest.member_name || reviewRequest.email} ({reviewRequest.email})</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">授權類型：</span>
                <span className={`font-semibold px-2 py-0.5 rounded text-[11px] ${reviewRequest.request_type === "lab" ? "bg-blue-100 text-blue-800 border border-blue-200" : "bg-emerald-100 text-emerald-800 border border-emerald-200"}`}>
                  {reviewRequest.request_type === "lab" ? "📍 地點動態授權 (Lab ID)" : "📟 單一設備授權 (ASLUNG ID)"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{reviewRequest.request_type === "lab" ? "申請地點：" : "申請設備："}</span>
                <span className="font-mono font-bold text-teal-700">
                  {reviewRequest.request_type === "lab"
                    ? `${reviewRequest.lab_id} ${[reviewRequest.city_name, reviewRequest.town_name, reviewRequest.location_name].filter(Boolean).join(" ")}`
                    : reviewRequest.aslung_id}
                </span>
              </div>
              {reviewRequest.reason && (
                <div className="flex justify-between">
                  <span className="text-slate-500 shrink-0">申請事由：</span>
                  <span className="text-slate-700 text-right">{reviewRequest.reason}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">申請時間：</span>
                <span className="text-slate-600">{localTime(reviewRequest.created_at)}</span>
              </div>
            </div>
            <input type="hidden" name="id" value={reviewRequest.id} />
            <input type="hidden" name="decision" value="APPROVED" />
            <div>
              <Label htmlFor="review-start" className="text-xs">核准資料開始時間 ({tz})</Label>
              <Input
                id="review-start"
                name="start"
                type="datetime-local"
                defaultValue={formatInTimeZone(new Date(Date.now() - 365 * 86400000), tz, "yyyy-MM-dd'T'HH:mm")}
                required
              />
            </div>
            <div>
              <Label htmlFor="review-end" className="text-xs">核准資料結束時間 ({tz}，留空代表無期限/永久)</Label>
              <Input id="review-end" name="end" type="datetime-local" />
              <p className="text-[11px] text-slate-400 mt-1">留空則會員可持續查詢最新資料。</p>
            </div>
          </div>
        )}
      </> : <>
        <div className="flex rounded-lg border border-slate-200 p-1 bg-slate-50 gap-1 mb-3">
          <button
            type="button"
            onClick={() => setGrantType("lab")}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              grantType === "lab"
                ? "bg-white text-blue-700 shadow-xs border border-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>📍 按地點授權 (Lab ID)</span>
            <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded font-normal">動態批次</span>
          </button>
          <button
            type="button"
            onClick={() => setGrantType("device")}
            className={`flex-1 py-1.5 px-3 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
              grantType === "device"
                ? "bg-white text-emerald-700 shadow-xs border border-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>📟 按設備授權 (ASLUNG ID)</span>
            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-normal">個別設備</span>
          </button>
        </div>

        {grantType === "lab" ? (
          <div>
            <div className="bg-blue-50/70 p-2.5 rounded-md border border-blue-100 text-xs text-blue-800 mb-2">
              💡 <strong>地點授權特色：</strong>授權該地點（如 <code>N0059</code>）後，該地點目前的所有設備及未來新調動至該地點的設備皆會<strong>自動繼承授權</strong>，無須逐台手動指派。
            </div>
            <Label>地點 (Lab ID)</Label>
            {pick(
              grantLab,
              setGrantLab,
              labs.map(l => {
                const devCount = devices.filter(d => d.location === l.id).length;
                const locName = [l.city_name, l.town_name, l.location_name].filter(Boolean).join(" ");
                return {
                  value: l.id,
                  label: `${l.id}${locName ? " · " + locName : ""} (${devCount} 台設備)`
                };
              }),
              "選擇要授權的地點 (Lab ID)"
            )}
          </div>
        ) : (
          <div>
            <Label>ASLUNG ID (設備編號)</Label>
            {pick(grantDevice,setGrantDevice,devices.map(d=>({value:d.id,label:d.id+(d.description?" · "+d.description:d.name?" · "+d.name:"")+(d.location?` [地點: ${d.location}]`:"")})),"選擇設備")}
          </div>
        )}

        <Label className="mt-2">會員</Label>
        {pick(grantEmail,setGrantEmail,members.filter(m=>m.role==="member"&&m.active).map(m=>({value:m.email,label:m.name+" · "+(m.nickname||(m.email.endsWith("@local.aslung")?"無":m.email))})),"選擇會員")}
        {grantType === "lab" && (
          <div className="bg-emerald-50/70 p-2.5 rounded-md border border-emerald-200 text-xs text-emerald-800 mt-2 space-y-1">
            <span className="font-bold flex items-center gap-1.5 text-emerald-900">
              🔄 自動動態繼承設備在站期間
            </span>
            <p>地點授權之會員將自動動態繼承該地點每台設備在設備追蹤中的實際進駐開始與移出結束日期，無須逐台維護。</p>
          </div>
        )}
        <Label htmlFor="grant-start" className="mt-2">{grantType === "lab" ? "可存取宏觀起始時間 (" + tz + "，預設動態繼承)" : "可存取資料開始時間 (" + tz + ")"}</Label>
        <Input id="grant-start" name="start" type="datetime-local" defaultValue={(()=>{const g=grants.find(g=>g.id===grantId);return g?formatInTimeZone(new Date(g.start), tz, "yyyy-MM-dd'T'HH:mm"):today()+"T00:00"})()} required={grantType !== "lab"}/>
        <Label htmlFor="grant-end" className="mt-2">{grantType === "lab" ? "可存取宏觀結束時間 (" + tz + "，留空自動動態繼承)" : "可存取資料結束時間 (" + tz + "，留空代表無期限/永久)"}</Label>
        <Input id="grant-end" name="end" type="datetime-local" defaultValue={(()=>{const g=grants.find(g=>g.id===grantId);return (g&&g.end)?formatInTimeZone(new Date(g.end), tz, "yyyy-MM-dd'T'HH:mm"):""})()} />
      </>}
      <div className="modal-actions">
        {modal==="deviceQr" ? (
          <Button type="button" variant="outline" onClick={()=>setModal("")}>{isEn ? "Close" : "關閉"}</Button>
        ) : (
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={()=>setModal("")}>{isEn ? "Cancel" : "取消"}</Button>
            {modal==="importCsv"?<div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={()=>{document.getElementById("csv-upload")?.click();}}><Upload size={14} className="mr-1"/>從檔案上傳</Button>
              <Button disabled={busy} type="submit">{busy?"匯入中…":"匯入貼上資料"}</Button>
            </div>:<Button disabled={busy||(modal==="grant"&&((grantType==="device"&&!grantDevice)||(grantType==="lab"&&!grantLab)||!grantEmail))||(modal==="requestGrant"&&((requestType==="device"&&!requestAslungId.trim())||(requestType==="lab"&&!requestLabId.trim())))} type="submit">{modal==="fileUpload"?(busy?"上傳中…":"上傳並指派授權"):modal==="fileGrant"?(busy?"儲存中…":"儲存授權設定"):modal==="requestGrant"?(busy?(isEn?"Submitting...":"送出中…"):(isEn?"Submit Request":"送出申請")):modal==="reviewGrant"?(busy?"審核中…":"確認核准開通"):modal==="labSync"||modal==="maintainerSync"?(busy?"同步中…":"開始同步"):(busy?"儲存中…":"儲存")}</Button>}
          </>
        )}
      </div>
    </form>
  </DialogContent>}
</Dialog>
 <AlertDialog open={!!confirmation} onOpenChange={v=>{if(!busy&&!v)setConfirmation(null)}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation?.title}</AlertDialogTitle><AlertDialogDescription>{confirmation?.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e=>{e.preventDefault();void mutate(confirmation)}}>{busy?"處理中…":"確認"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 
  {/* Clipping Warning Modal */}
  <Dialog open={!!clippingWarning} onOpenChange={v => !v && setClippingWarning(null)}>
    <DialogContent className="bg-white sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-amber-700">
          <AlertTriangle size={20} className="text-amber-500" />
          查詢時間超出在站授權範圍
        </DialogTitle>
        <DialogDescription className="text-slate-600 text-xs">
          設備在該站點的實際擺放服役期間與您輸入的時間部分不重疊。
        </DialogDescription>
      </DialogHeader>
      {clippingWarning && (
        <div className="space-y-3 py-2 text-xs">
          <div className="bg-slate-50 p-3 rounded-lg border space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-500">設備編號：</span>
              <span className="font-mono font-bold text-slate-800">{clippingWarning.device.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">原始輸入期間：</span>
              <span className="font-mono text-slate-700">{clippingWarning.original.start} ～ {clippingWarning.original.end}</span>
            </div>
          </div>

          <div className="bg-teal-50/80 p-3 rounded-lg border border-teal-200 space-y-1">
            <span className="text-teal-900 font-bold block mb-1">💡 系統將自動調整為有效在站重疊期間：</span>
            <p className="font-mono font-bold text-teal-800 text-sm">
              {clippingWarning.clipped.start} ～ {clippingWarning.clipped.end}
            </p>
            <p className="text-[11px] text-teal-700 mt-1">超出此範圍的時間該設備已移出本站，無在站有效數據。</p>
          </div>
        </div>
      )}
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={() => setClippingWarning(null)}>取消</Button>
        <Button
          className="bg-teal-700 hover:bg-teal-800"
          onClick={() => {
            if (!clippingWarning) return;
            const { clipped, actionType, format, device } = clippingWarning;
            setStart(clipped.start);
            setEnd(clipped.end);
            setClippingWarning(null);
            if (actionType === "query") {
              setTimeout(() => {
                void query({ id: device.id, segment_id:device.segment_id, start: clipped.isoStart || zoned(clipped.start), end: clipped.isoEnd || zoned(clipped.end) });
              }, 100);
            } else if (actionType === "download" && format) {
              setTimeout(() => {
                void executeDirectDownload(device.id, clipped.isoStart || zoned(clipped.start), clipped.isoEnd || zoned(clipped.end), format, device.segment_id);
              }, 100);
            }
          }}
        >
          確定，以調整後時間繼續
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  {/* Batch Download Progress Modal */}
  <Dialog open={batchModalOpen} onOpenChange={v => { if (!batchRunning) setBatchModalOpen(v); }}>
    <DialogContent className="bg-white sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FolderDown size={20} className="text-teal-600" />
          批次打包下載所選設備
        </DialogTitle>
        <DialogDescription className="text-xs">
          共 {devices.length} 台設備 · 查詢區間：{start} ～ {end}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2 flex-1 overflow-y-auto">
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-slate-600 font-medium">
            <span>{batchRunning ? "正在逐台擷取數據並打包中..." : "批次處理完成"}</span>
            <span className="font-mono font-bold">{batchProgress}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-teal-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${batchProgress}%` }}
            />
          </div>
        </div>

        <div className="border rounded-lg max-h-56 overflow-y-auto divide-y bg-slate-50 text-xs">
          {batchLogs.map((log) => (
            <div key={log.id} className="p-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono font-bold text-slate-800">{log.id}</span>
                {log.validRange && <span className="text-[10px] text-slate-500 font-mono">({log.validRange})</span>}
              </div>
              <div>
                {log.status === "waiting" && <span className="text-slate-400">等待中</span>}
                {log.status === "fetching" && <span className="text-teal-600 font-medium flex items-center gap-1"><RefreshCw size={12} className="animate-spin" />下載中...</span>}
                {log.status === "success" && <span className="text-emerald-700 font-semibold flex items-center gap-1"><CheckCircle2 size={13} /> {log.count} 筆</span>}
                {log.status === "skipped" && <span className="text-slate-400 text-[11px]">{log.message || "略過"}</span>}
                {log.status === "error" && <span className="text-red-600 font-medium">{log.message || "錯誤"}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <DialogFooter className="border-t pt-3 flex justify-between items-center sm:justify-between">
        <span className="text-[11px] text-slate-400">每台設備獨立存為一個檔案並封裝成 ZIP</span>
        <div className="flex gap-2">
          {batchBlobUrl && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const a = document.createElement("a");
                a.href = batchBlobUrl;
                a.download = batchZipFilename || "ASLUNG_Export.zip";
                a.click();
              }}
            >
              <Download size={14} className="mr-1" /> 再次下載 ZIP
            </Button>
          )}
          <Button
            size="sm"
            disabled={batchRunning}
            onClick={() => setBatchModalOpen(false)}
          >
            {batchRunning ? "處理中…" : "關閉"}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</SidebarProvider>;
}
