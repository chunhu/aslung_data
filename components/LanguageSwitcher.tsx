"use client";
import { useEffect } from "react";
import {Button} from "@/components/ui/button";
import useAppLanguage from "@/components/useAppLanguage";
import {applyDisplayLanguage} from "@/lib/language.mjs";

export default function LanguageSwitcher({reloadOnChange=true,translatePage=true}:{reloadOnChange?:boolean;translatePage?:boolean}={}) {
  const lang=useAppLanguage();
  useEffect(() => {
    if (!translatePage || lang!=="en" || document.getElementById("google-translate-script")) return;
    const addScript = document.createElement("script");
    addScript.id = "google-translate-script";
    addScript.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    addScript.async = true;

    
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
    document.body.appendChild(addScript);
  }, [lang,translatePage]);

  const changeLanguage = () => {
    const next=lang==="en"?"zh-TW":"en";
    const url=new URL(window.location.href);
    if(url.searchParams.has("lang")){url.searchParams.set("lang",next);window.history.replaceState(null,"",url);}
    applyDisplayLanguage(next,true);
    if(reloadOnChange)window.location.reload();
  };
  return <div className="flex items-center gap-2 notranslate" translate="no">
    {translatePage&&<div id="google_translate_element" style={{position:"absolute",left:"-9999px",top:"-9999px",width:"1px",height:"1px",overflow:"hidden"}}/>}
    <Button type="button" variant="outline" size="sm" disabled={!lang} onClick={changeLanguage}
      lang={lang==="en"?"zh-Hant":"en"} aria-label={lang==="en"?"切換為中文":"Switch to English"}
      className="h-8 min-w-20 text-xs bg-white/50 border-slate-200">{lang==="en"?"中文":"English"}</Button>
  </div>;
}
