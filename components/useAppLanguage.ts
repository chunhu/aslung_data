"use client";
import {useEffect,useState} from 'react';
import {resolveDisplayLanguage,applyDisplayLanguage} from '@/lib/language.mjs';
export default function useAppLanguage(initialLanguage?:string){
  const [language,setLanguage]=useState<string|null>(null);
  useEffect(()=>{
    const update=()=>setLanguage(resolveDisplayLanguage(document.cookie,navigator,new URLSearchParams(location.search).get('lang')||initialLanguage));
    const chosen=resolveDisplayLanguage(document.cookie,navigator,new URLSearchParams(location.search).get('lang')||initialLanguage);
    // Explicit language links are a user choice; browser detection is only the default.
    applyDisplayLanguage(chosen,['en','zh-TW'].includes(new URLSearchParams(location.search).get('lang')||''));
    update();window.addEventListener('aslung-language-change',update);
    const browserChanged=()=>{applyDisplayLanguage(resolveDisplayLanguage(document.cookie,navigator));update();};
    window.addEventListener('languagechange',browserChanged);
    return()=>{window.removeEventListener('aslung-language-change',update);window.removeEventListener('languagechange',browserChanged);};
  },[initialLanguage]);
  return language;
}
