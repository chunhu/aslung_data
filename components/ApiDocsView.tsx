"use client";
import { useState, useEffect } from "react";
import { Code2, FileText, Download, Copy, Check, BookOpen, Terminal, FileCode, ShieldAlert, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { toast } from "sonner";

export default function ApiDocsView({ initialLang }: { initialLang?: "zh" | "en" } = {}) {
  const [lang, setLang] = useState<"zh" | "en">(initialLang || "zh");

  useEffect(() => {
    if (initialLang) setLang(initialLang);
  }, [initialLang]);
  const [copiedKey, setCopiedKey] = useState<string>("");

  const copyCode = (code: string, key: string) => {
    navigator.clipboard.writeText(code);
    setCopiedKey(key);
    toast.success(lang === "zh" ? "程式碼已複製到剪貼簿" : "Code copied to clipboard");
    setTimeout(() => setCopiedKey(""), 2000);
  };

  const isZh = lang === "zh";

  const pythonCode = `# Python 範例：使用 requests 與 pandas 下載並分析
import io
import requests
import pandas as pd

API_URL = "https://api.lunglab.rcec.sinica.edu.tw/api/data"
API_TOKEN = "aslung_your_token_here"
DEVICE_ID = "AL-0001"
START_TIME = "2026-10-01T00:00:00+08:00"
END_TIME = "2026-10-05T23:59:59+08:00"

headers = {
    "Authorization": f"Bearer {API_TOKEN}"
}

# 帶入 download=1&format=csv 直接串流取得完整 CSV 並轉為 DataFrame
csv_url = f"{API_URL}?aslung_id={DEVICE_ID}&start={START_TIME}&end={END_TIME}&download=1&format=csv"
response = requests.get(csv_url, headers=headers)

if response.status_code == 200:
    df = pd.read_csv(io.StringIO(response.text))
    print(f"成功取得 {len(df)} 筆監測數據！")
    print(df[["timestamp", "PM2.5_G3", "temperature", "rh", "co2"]].head())
else:
    print(f"查詢失敗 ({response.status_code}):", response.text)
`;

  const curlCode = `# 1. 分頁查詢 JSON 數據（單頁最多 1000 筆）
curl -X GET "https://api.lunglab.rcec.sinica.edu.tw/api/data?aslung_id=AL-0001&start=2026-10-01T00:00:00+08:00&end=2026-10-03T00:00:00+08:00" \\
     -H "Authorization: Bearer aslung_your_token_here"

# 2. 直接下載完整期間 CSV 檔案
curl -X GET "https://api.lunglab.rcec.sinica.edu.tw/api/data?aslung_id=AL-0001&start=2026-10-01T00:00:00+08:00&end=2026-10-07T23:59:59+08:00&download=1&format=csv" \\
     -H "Authorization: Bearer aslung_your_token_here" \\
     -o aslung_AL-0001_export.csv
`;

  const jsCode = `// Node.js / JavaScript Fetch 範例
const API_URL = "https://api.lunglab.rcec.sinica.edu.tw/api/data";
const API_TOKEN = "aslung_your_token_here";

async function fetchSensorData() {
  const params = new URLSearchParams({
    aslung_id: "AL-0001",
    start: "2026-10-01T00:00:00+08:00",
    end: "2026-10-03T00:00:00+08:00"
  });

  const res = await fetch(\`\${API_URL}?\${params.toString()}\`, {
    method: "GET",
    headers: {
      "Authorization": \`Bearer \${API_TOKEN}\`,
      "Accept": "application/json"
    }
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "查詢失敗");
  }

  const result = await res.json();
  console.log(\`取得 \${result.data.length} 筆資料\`, result.data[0]);
}

fetchSensorData();
`;

  const jsonSample = `{
  "aslung_id": "AL-0001",
  "start": "2026-09-30T16:00:00.000Z",
  "end": "2026-10-01T16:00:00.000Z",
  "data": [
    {
      "id": 105820,
      "aslung_id": "AL-0001",
      "timestamp": "2026-09-30T16:00:15.000Z",
      "PM1_G3": 11.2,
      "PM2.5_G3": 15.6,
      "PM10_G3": 22.4,
      "temperature": 27.5,
      "rh": 68.2,
      "co2": 510,
      "battery": 98,
      "PM1_GSA": 10.8,
      "PM2.5_GSA": 14.9,
      "PM10_GSA": 21.8
    }
  ],
  "has_more": true,
  "next_cursor": "eyJ0aW1lIjoiMjAyNi0wOS0zMCAxNjowMDoxNSIsImlkIjoxMDU4MjB9"
}`;

  const fieldsData = [
    { name: "timestamp", type: "string", descZh: "量測時間戳記（ISO 8601 UTC 格式，如 2026-10-01T08:00:15.000Z）", descEn: "Measurement timestamp (ISO 8601 UTC format, e.g. 2026-10-01T08:00:15.000Z)" },
    { name: "aslung_id", type: "string", descZh: "ASLUNG 設備識別碼", descEn: "ASLUNG device identifier" },
    { name: "PM1_G3", type: "number", descZh: "PM1.0 顆粒物質量濃度（Plantower G3 感測器，μg/m³）", descEn: "PM1.0 mass concentration (Plantower G3 sensor, μg/m³)" },
    { name: "PM2.5_G3", type: "number", descZh: "PM2.5 顆粒物質量濃度（Plantower G3 感測器，μg/m³）", descEn: "PM2.5 mass concentration (Plantower G3 sensor, μg/m³)" },
    { name: "PM10_G3", type: "number", descZh: "PM10 顆粒物質量濃度（Plantower G3 感測器，μg/m³）", descEn: "PM10 mass concentration (Plantower G3 sensor, μg/m³)" },
    { name: "temperature", type: "number", descZh: "環境溫度（°C）", descEn: "Ambient temperature (°C)" },
    { name: "rh", type: "number", descZh: "相對濕度（%）", descEn: "Relative humidity (%)" },
    { name: "co2", type: "number", descZh: "二氧化碳濃度（ppm）", descEn: "Carbon dioxide concentration (ppm)" },
    { name: "battery", type: "number", descZh: "設備電池剩餘電量百分比（%）", descEn: "Device battery percentage (%)" },
    { name: "acc_x, acc_y, acc_z", type: "number", descZh: "三軸加速度計讀值（X / Y / Z 軸）", descEn: "Tri-axial accelerometer readings (X / Y / Z axes)" },
    { name: "gps", type: "string", descZh: "GPS 經緯度座標字串", descEn: "GPS coordinate string" },
    { name: "gps_speed", type: "number", descZh: "移動速度（km/h）", descEn: "Movement speed (km/h)" },
    { name: "gps_direction", type: "number", descZh: "前進航向角（度）", descEn: "Heading direction (degrees)" },
    { name: "gps_height", type: "number", descZh: "GPS 海拔高度（公尺）", descEn: "Altitude (meters)" },
    { name: "air_pressure", type: "number", descZh: "大氣壓力值（hPa）", descEn: "Atmospheric pressure (hPa)" },
    { name: "noise1, noise2, noise3", type: "number", descZh: "噪音感測器通道讀值（dB）", descEn: "Noise sensor channel readings (dB)" },
    { name: "PM1_GSA", type: "number", descZh: "PM1.0 顆粒物質量濃度（GSA 感測器，μg/m³）", descEn: "PM1.0 mass concentration (GSA sensor, μg/m³)" },
    { name: "PM2.5_GSA", type: "number", descZh: "PM2.5 顆粒物質量濃度（GSA 感測器，μg/m³）", descEn: "PM2.5 mass concentration (GSA sensor, μg/m³)" },
    { name: "PM10_GSA", type: "number", descZh: "PM10 顆粒物質量濃度（GSA 感測器，μg/m³）", descEn: "PM10 mass concentration (GSA sensor, μg/m³)" },
    { name: "Num_0.3_GSA ~ 10_GSA", type: "number", descZh: "不同粒徑顆粒計數（≥ 0.3, 0.5, 1.0, 2.5, 5.0, 10 μm）", descEn: "Particle counts for diameters ≥ 0.3, 0.5, 1.0, 2.5, 5.0, 10 μm" }
  ];

  const paramsData = [
    { name: "aslung_id", type: "string", reqZh: "是", reqEn: "Yes", descZh: "要查詢的設備編號識別碼", descEn: "Device identifier to query", ex: "AL-0001" },
    { name: "start", type: "string", reqZh: "是", reqEn: "Yes", descZh: "查詢起始時間（需包含時區的 ISO 8601 格式）", descEn: "Start timestamp (ISO 8601 format with timezone)", ex: "2026-10-01T00:00:00+08:00" },
    { name: "end", type: "string", reqZh: "是", reqEn: "Yes", descZh: "查詢結束時間（需包含時區的 ISO 8601 格式）", descEn: "End timestamp (ISO 8601 format with timezone)", ex: "2026-10-07T23:59:59+08:00" },
    { name: "cursor", type: "string", reqZh: "否", reqEn: "No", descZh: "分頁游標；資料超過 1000 筆時帶入上一頁回傳的 next_cursor", descEn: "Pagination cursor from previous response", ex: "eyJ0aW1lIjoi..." },
    { name: "download", type: "string", reqZh: "否", reqEn: "No", descZh: "設為 1 時啟動完整合併下載模式", descEn: "When set to 1, merges all pages into full export", ex: "1" },
    { name: "format", type: "string", reqZh: "否", reqEn: "No", descZh: "匯出格式：json 或 csv（預設為 json，需搭配 download=1）", descEn: "Export format: json or csv (requires download=1)", ex: "csv" }
  ];

  const errorsData = [
    { code: "400 Bad Request", reasonZh: "參數缺失、格式錯誤、開始時間晚於結束時間，或查詢區間超過 31 天。", reasonEn: "Missing parameter, invalid date format, or interval exceeds 31 days.", fixZh: "檢查參數名稱與 ISO 8601 格式，縮短日期範圍至 31 天以內。", fixEn: "Verify parameters and shorten range to 31 days or less." },
    { code: "401 Unauthorized", reasonZh: "未提供 Token 或 Token 已失效。", reasonEn: "Missing Authorization token or token invalid/revoked.", fixZh: "檢查 Header 是否包含 Authorization: Bearer <Token>。", fixEn: "Ensure Authorization header includes a valid Bearer token." },
    { code: "403 Forbidden", reasonZh: "此帳號尚未被授權存取該設備，或查詢期間超出核准區間。", reasonEn: "Account is not authorized for this device or outside permitted window.", fixZh: "透過工作空間提出「申請設備授權」，或聯絡管理員開通。", fixEn: "Request access in the workspace or contact administrator." },
    { code: "404 Not Found", reasonZh: "系統中查無此設備識別碼。", reasonEn: "Device ID does not exist in database.", fixZh: "確認 ASLUNG ID 拼寫是否正確。", fixEn: "Verify device identifier spelling." },
    { code: "502 Bad Gateway", reasonZh: "MySQL 資料庫連線中斷或伺服器異常。", reasonEn: "EC2 MySQL database connection failed.", fixZh: "稍後重試或通報系統管理員檢查 EC2 狀態。", fixEn: "Retry later or report to system administrator." }
  ];

  return (
    <section className="panel p-6 sm:p-7 space-y-6">
      {/* Header and Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center font-bold">
              <BookOpen size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                {isZh ? "ASLUNG 數據查詢與下載 API 使用手冊" : "ASLUNG Data Query & Download API Guide"}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isZh ? "所有註冊會員均可使用專屬 API Token 進行自動化串接與資料分析" : "All members can use dedicated API Tokens for automated integration and analysis"}
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Language Switch */}
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs">
            <button
              type="button"
              onClick={() => setLang("zh")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${isZh ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-800"}`}
            >
              繁體中文
            </button>
            <button
              type="button"
              onClick={() => setLang("en")}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${!isZh ? "bg-white text-slate-800 shadow-xs" : "text-slate-500 hover:text-slate-800"}`}
            >
              English
            </button>
          </div>

          {/* Download Buttons */}
          <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs text-slate-700 hover:text-slate-900">
            <a href={isZh ? "/docs/ASLUNG_API_User_Guide_ZH.docx" : "/docs/ASLUNG_API_User_Guide_EN.docx"} download>
              <FileText size={14} className="text-blue-600" />
              {isZh ? "下載 Word 檔 (.docx)" : "Download Word (.docx)"}
            </a>
          </Button>

          <Button variant="outline" size="sm" asChild className="h-8 gap-1.5 text-xs text-slate-700 hover:text-slate-900">
            <a href={isZh ? "/docs/ASLUNG_API_User_Guide_ZH.md" : "/docs/ASLUNG_API_User_Guide_EN.md"} download>
              <FileCode size={14} className="text-slate-600" />
              {isZh ? "下載 Markdown (.md)" : "Download Markdown (.md)"}
            </a>
          </Button>
        </div>
      </div>

      {/* Endpoint Badge */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <span className="px-2 py-0.5 rounded font-mono font-bold bg-teal-700 text-white text-[11px]">GET</span>
          <code className="text-xs sm:text-sm font-semibold text-slate-800 font-mono">https://api.lunglab.rcec.sinica.edu.tw/api/data</code>
          <span className="text-slate-500 hidden md:inline">
            {isZh ? "（支援 Bearer Token 與 Session Cookie 身分認證）" : "(Supports Bearer Token & Session Cookie authentication)"}
          </span>
        </div>
        <div className="font-mono text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded text-[11px] self-start sm:self-auto">
          Authorization: Bearer &lt;YOUR_API_TOKEN&gt;
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="params">
        <TabsList className="bg-slate-100 p-1">
          <TabsTrigger value="params" className="text-xs">{isZh ? "請求參數與規則" : "Parameters & Rules"}</TabsTrigger>
          <TabsTrigger value="fields" className="text-xs">{isZh ? "感測器欄位對照" : "Sensor Fields"}</TabsTrigger>
          <TabsTrigger value="code" className="text-xs">{isZh ? "程式串接範例" : "Code Examples"}</TabsTrigger>
          <TabsTrigger value="response" className="text-xs">{isZh ? "回傳結構與錯誤碼" : "Response & Errors"}</TabsTrigger>
        </TabsList>

        {/* Tab 1: Parameters */}
        <TabsContent value="params" className="space-y-4 pt-3">
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">{isZh ? "參數名稱" : "Parameter"}</TableHead>
                  <TableHead className="w-20">{isZh ? "類型" : "Type"}</TableHead>
                  <TableHead className="w-16">{isZh ? "必填" : "Required"}</TableHead>
                  <TableHead>{isZh ? "用途說明" : "Description"}</TableHead>
                  <TableHead className="w-48">{isZh ? "範例值" : "Example"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paramsData.map(p => (
                  <TableRow key={p.name}>
                    <TableCell className="font-mono font-semibold text-teal-800">{p.name}</TableCell>
                    <TableCell className="mono text-xs text-slate-500">{p.type}</TableCell>
                    <TableCell><span className={`text-[11px] px-1.5 py-0.5 rounded font-bold ${p.reqZh === "是" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"}`}>{isZh ? p.reqZh : p.reqEn}</span></TableCell>
                    <TableCell className="text-sm text-slate-700">{isZh ? p.descZh : p.descEn}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">{p.ex}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-900 space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <ShieldAlert size={14} className="text-amber-700" />
              {isZh ? "查詢區間限制與安全注意事項：" : "Query Constraints & Security Notes:"}
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-amber-800">
              <li>{isZh ? "單次查詢期間（end - start）上限為 31 天。如需下載超過 31 天的歷史數據，請依月份批次分段呼叫。" : "Maximum query range (end - start) is 31 days. Please split longer queries into monthly batches."}</li>
              <li>{isZh ? "時間參數必須包含時區資訊（如 +08:00 或 Z），start 時間不得晚於 end。" : "Timestamps must include timezone information (+08:00 or Z); start cannot be later than end."}</li>
              <li>{isZh ? "一般會員僅能查詢經管理員核准授權或列管之設備與時間區間，越權查詢將回傳 403 錯誤。" : "Members can only query granted devices within approved time windows (unauthorized queries return 403)."}</li>
            </ul>
          </div>
        </TabsContent>

        {/* Tab 2: Fields */}
        <TabsContent value="fields" className="space-y-4 pt-3">
          <div className="border border-slate-200 rounded-lg overflow-hidden max-h-[420px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-48 sticky top-0 bg-white">{isZh ? "欄位代碼" : "Field Name"}</TableHead>
                  <TableHead className="w-24 sticky top-0 bg-white">{isZh ? "數據型態" : "Type"}</TableHead>
                  <TableHead className="sticky top-0 bg-white">{isZh ? "單位與物理意義說明" : "Unit / Description"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fieldsData.map(f => (
                  <TableRow key={f.name}>
                    <TableCell className="font-mono font-semibold text-slate-800">{f.name}</TableCell>
                    <TableCell className="mono text-xs text-slate-500">{f.type}</TableCell>
                    <TableCell className="text-sm text-slate-700">{isZh ? f.descZh : f.descEn}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Tab 3: Code Examples */}
        <TabsContent value="code" className="space-y-5 pt-3">
          {/* Python */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Terminal size={14} className="text-blue-600" />
                Python（使用 requests + pandas 自動載入 DataFrame）
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-slate-600"
                onClick={() => copyCode(pythonCode, "python")}
              >
                {copiedKey === "python" ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                {copiedKey === "python" ? (isZh ? "已複製" : "Copied") : (isZh ? "複製代碼" : "Copy Code")}
              </Button>
            </div>
            <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
              {pythonCode}
            </pre>
          </div>

          {/* cURL */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Code2 size={14} className="text-teal-600" />
                cURL 命令列（分頁查詢 & 直接下載 CSV）
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-slate-600"
                onClick={() => copyCode(curlCode, "curl")}
              >
                {copiedKey === "curl" ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                {copiedKey === "curl" ? (isZh ? "已複製" : "Copied") : (isZh ? "複製代碼" : "Copy Code")}
              </Button>
            </div>
            <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
              {curlCode}
            </pre>
          </div>

          {/* JavaScript */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <FileCode size={14} className="text-amber-600" />
                JavaScript / Node.js
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-slate-600"
                onClick={() => copyCode(jsCode, "js")}
              >
                {copiedKey === "js" ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                {copiedKey === "js" ? (isZh ? "已複製" : "Copied") : (isZh ? "複製代碼" : "Copy Code")}
              </Button>
            </div>
            <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
              {jsCode}
            </pre>
          </div>
        </TabsContent>

        {/* Tab 4: Response & Errors */}
        <TabsContent value="response" className="space-y-5 pt-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                {isZh ? "分頁查詢 JSON 回應結構（含 next_cursor）：" : "Paginated JSON Response Structure (with next_cursor):"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-slate-600"
                onClick={() => copyCode(jsonSample, "jsonSample")}
              >
                {copiedKey === "jsonSample" ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                {copiedKey === "jsonSample" ? (isZh ? "已複製" : "Copied") : (isZh ? "複製代碼" : "Copy Code")}
              </Button>
            </div>
            <pre className="p-3.5 bg-slate-900 text-teal-300 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
              {jsonSample}
            </pre>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-700">
              {isZh ? "HTTP 狀態碼與錯誤處理對照表：" : "HTTP Status Codes & Resolution:"}
            </h3>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">{isZh ? "狀態碼" : "Status Code"}</TableHead>
                    <TableHead>{isZh ? "錯誤原因" : "Error Reason"}</TableHead>
                    <TableHead>{isZh ? "排解方式" : "Resolution"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errorsData.map(e => (
                    <TableRow key={e.code}>
                      <TableCell className="font-mono font-bold text-red-700">{e.code}</TableCell>
                      <TableCell className="text-sm text-slate-700">{isZh ? e.reasonZh : e.reasonEn}</TableCell>
                      <TableCell className="text-sm text-slate-600">{isZh ? e.fixZh : e.fixEn}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
