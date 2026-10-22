"use client";

import { useEffect, useState } from "react";
import { BookOpen, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ApiDocsView({ initialLang }: { initialLang?: "zh" | "en" } = {}) {
  const [lang, setLang] = useState<"zh" | "en">(initialLang || "zh");
  const [guide, setGuide] = useState("website");
  useEffect(() => { if (initialLang) setLang(initialLang); }, [initialLang]);
  const isZh = lang === "zh";
  const title = guide === "website"
    ? (isZh ? "完整網站使用說明" : "Complete website manual")
    : (isZh ? "API 使用說明" : "API user guide");
  const stem = `/docs/ASLUNG_${guide === "website" ? "Website_User_Manual" : "API_User_Guide"}_${isZh ? "ZH" : "EN"}`;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold"><BookOpen className="size-6" />{isZh ? "說明文件" : "Documentation"}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{isZh ? "涵蓋資料查詢、下載、設備管理、校正、HOBO 與維運；可線上閱讀或下載。" : "Read or download instructions for queries, exports, fleet management, calibration, HOBO and operations."}</p>
        </div>
        <Button variant="outline" onClick={() => setLang(isZh ? "en" : "zh")}>{isZh ? "English" : "中文"}</Button>
      </div>
      <Tabs value={guide} onValueChange={setGuide}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="website">{isZh ? "完整網站說明" : "Website manual"}</TabsTrigger>
          <TabsTrigger value="api">{isZh ? "API 使用說明" : "API guide"}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline"><a href={`${stem}.docx`} download><Download className="size-4" />{isZh ? "下載 Word" : "Download Word"}</a></Button>
        <Button asChild variant="outline"><a href={`${stem}.md`} download>{isZh ? "下載 Markdown" : "Download Markdown"}</a></Button>
        <Button asChild variant="outline"><a href={`${stem}.html`} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />{isZh ? "另開說明頁面" : "Open in new tab"}</a></Button>
      </div>
      <iframe key={stem} src={`${stem}.html`} title={title} className="h-[75vh] min-h-[500px] w-full rounded-xl border bg-white" />
    </section>
  );
}
