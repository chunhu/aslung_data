"use client";
import {createContext,useContext,useMemo} from 'react';
import {maintainerDisplayName} from '@/lib/maintainer-names.mjs';
type Maintainer={name:string;english_name?:string};
const Context=createContext<{maintainers:Maintainer[];isEnglish:boolean}>({maintainers:[],isEnglish:false});
export function MaintainerNamesProvider({maintainers,isEnglish,children}:{maintainers:Maintainer[];isEnglish:boolean;children:React.ReactNode}){
  const value=useMemo(()=>({maintainers,isEnglish}),[maintainers,isEnglish]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useMaintainerNames(){
  const {maintainers,isEnglish}=useContext(Context);
  return (name:string)=>maintainerDisplayName(name,maintainers,isEnglish);
}
export default function MaintainerName({name}:{name:string}){
  const display=useMaintainerNames();
  return <span translate="no" className="notranslate">{display(name)}</span>;
}
