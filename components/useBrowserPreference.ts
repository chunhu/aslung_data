"use client";
import {useEffect,useState} from 'react';

// Hydrate before writing, so defaults never overwrite a saved preference.
export default function useBrowserPreference<T>(key:string|null,fallback:T,normalize:(value:unknown)=>T){
  const [value,setValue]=useState<T>(fallback),[loadedKey,setLoadedKey]=useState<string|null>(null);
  useEffect(()=>{
    let stored:unknown;
    try{stored=key?JSON.parse(window.localStorage.getItem(key)||'null'):null;}catch{stored=null;}
    setValue(normalize(stored));setLoadedKey(key);
  },[key,normalize]);
  useEffect(()=>{
    if(!key||loadedKey!==key)return;
    try{window.localStorage.setItem(key,JSON.stringify(value));}catch{/* Navigation remains usable without persistent storage. */}
  },[key,loadedKey,value]);
  return [value,setValue,loadedKey===key] as const;
}
