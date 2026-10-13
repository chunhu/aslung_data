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
    
    const ensureCleanStyles = () => {
      if (!document.getElementById("gt-clean-style")) {
        const style = document.createElement("style");
        style.id = "gt-clean-style";
        style.innerHTML = `
          html body .goog-text-highlight,
          html body font.goog-text-highlight,
          html body font[style*="background-color"],
          html body font,
          html body font:hover {
            background-color: transparent !important;
            background: transparent !important;
            box-shadow: none !important;
            -webkit-box-shadow: none !important;
            border: none !important;
            color: inherit !important;
          }
          #goog-gt-tt, .goog-tooltip, .goog-te-balloon-frame {
            display: none !important;
            visibility: hidden !important;
          }
        `;
        document.head.appendChild(style);
      }
    };
    ensureCleanStyles();

    (window as any).googleTranslateElementInit = () => {
      ensureCleanStyles();
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
        <SelectTrigger className="w-24 sm:w-28 h-8 text-xs bg-white/50 border-slate-200">
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
