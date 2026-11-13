"use client";
import {useEffect,useRef} from 'react';
import {usePathname} from 'next/navigation';
import {VISIT_PATHS} from '@/lib/activity-paths.mjs';
export default function VisitTracker(){
  const pathname=usePathname(),last=useRef({path:'',time:0});
  useEffect(()=>{
    const track=()=>{
      if(document.visibilityState==='hidden')return;
      const path=pathname==='/'&&window.location.hash?'/'+window.location.hash:pathname;
      if(path==='/'||!VISIT_PATHS.includes(path)||last.current.path===path&&Date.now()-last.current.time<3000)return;
      last.current={path,time:Date.now()};
      void fetch('/api/activity/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path}),keepalive:true})
        .then(async response=>{if(response.ok)window.dispatchEvent(new CustomEvent('aslung-stats-updated',{detail:await response.json()}));}).catch(()=>{});
    };
    track();window.addEventListener('aslung-navigation',track);window.addEventListener('hashchange',track);document.addEventListener('visibilitychange',track);
    return()=>{window.removeEventListener('aslung-navigation',track);window.removeEventListener('hashchange',track);document.removeEventListener('visibilitychange',track);};
  },[pathname]);
  return null;
}
