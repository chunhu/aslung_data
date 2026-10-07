"use client";
import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function LanguageSwitcher() {
  const [lang, setLang] = useState("zh-TW");

  useEffect(() => {
    // Detect existing language from cookie
    const match = document.cookie.match(/(^|;) ?googtrans=([^;]*)(;|$)/);
    if (match && match[2]) {
      const val = decodeURIComponent(match[2]);
      if (val.endsWith("/en")) setLang("en");
    }

    if (document.getElementById("google-translate-script")) return;
    
    const addScript = document.createElement("script");
    addScript.id = "google-translate-script";
    addScript.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    addScript.async = true;
    document.body.appendChild(addScript);
    
    (window as any).googleTranslateElementInit = () => {
      new (window as any).google.translate.TranslateElement(
        { pageLanguage: "zh-TW", includedLanguages: "en,zh-TW", autoDisplay: false },
        "google_translate_element"
      );
    };
  }, []);

  const changeLanguage = (newLang: string) => {
    setLang(newLang);
    
    // Always persist cookie
    if (newLang === "zh-TW") {
      document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; domain=" + location.hostname + "; path=/;";
    } else {
      document.cookie = "googtrans=/zh-TW/" + newLang + "; path=/";
      document.cookie = "googtrans=/zh-TW/" + newLang + "; domain=" + location.hostname + "; path=/";
    }

    // Always reload to guarantee translation applies cleanly without DOM conflicts
    window.location.reload();
  };

  return (
    <div className="flex items-center gap-2">
      <div id="google_translate_element" style={{ position: "absolute", left: "-9999px", top: "-9999px", width: "1px", height: "1px", overflow: "hidden" }}></div>
      <Select value={lang} onValueChange={changeLanguage}>
        <SelectTrigger className="w-28 h-8 text-xs bg-white/50 border-slate-200">
          <SelectValue placeholder="Language" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="zh-TW">繁體中文</SelectItem>
          <SelectItem value="en">English</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
