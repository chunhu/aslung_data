"use client";
import {useEffect,useState} from 'react';

export const WORKSPACE_SECTIONS=['news','articles','realtime','data','devices','maintenance','calibration','hobo','members','permissions','locations','labs','maintainers','alerts','files','connection'];
export default function useWorkspaceSection(){
  const [section,setSection]=useState('data');
  const [restored,setRestored]=useState(false);
  useEffect(()=>{
    let saved:string|null=null;
    try{saved=window.localStorage.getItem('aslung_section');}catch{/* Navigation still works when browser storage is unavailable. */}
    const hash=window.location.hash.replace(/^#/,'');
    const target=WORKSPACE_SECTIONS.includes(hash)?hash:saved&&WORKSPACE_SECTIONS.includes(saved)?saved:'data';
    setSection(target);
    setRestored(true);
    const onHashChange=()=>{
      const next=window.location.hash.replace(/^#/,'');
      if(WORKSPACE_SECTIONS.includes(next))setSection(next);
    };
    window.addEventListener('hashchange',onHashChange);
    return()=>window.removeEventListener('hashchange',onHashChange);
  },[]);
  useEffect(()=>{
    // Wait for the restored state to render before persisting anything. In
    // particular, the initial "data" value must not overwrite #hobo on mount.
    if(!restored)return;
    try{window.localStorage.setItem('aslung_section',section);}catch{/* URL state remains available. */}
    if(window.location.hash!==`#${section}`)window.history.replaceState(null,'',`#${section}`);
  },[section,restored]);
  return [section,setSection] as const;
}
