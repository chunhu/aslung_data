"use client";
import {useEffect,type ComponentType,type ReactNode} from 'react';
import {ChevronDown,PanelLeftClose,PanelLeftOpen} from 'lucide-react';
import {SidebarProvider,SidebarMenu,SidebarMenuItem,SidebarMenuButton,useSidebar} from '@/components/ui/sidebar';
import {Button} from '@/components/ui/button';
import useBrowserPreference from '@/components/useBrowserPreference';

export const NAVIGATION_GROUPS=[
  {id:'resources',zh:'消息與資源',en:'News and resources',sections:['news','articles','files']},
  {id:'data',zh:'監測與資料',en:'Monitoring and data',sections:['realtime','data','hobo']},
  {id:'devices',zh:'設備管理',en:'Device management',sections:['personal','devices','locations','labs','maintainers','maintenance']},
  {id:'calibration',zh:'校正與異常通知',en:'Calibration and notifications',sections:['calibration','alerts']},
  {id:'members',zh:'會員與權限',en:'Members and access',sections:['members','permissions']},
  {id:'integration',zh:'資料串接',en:'Data integration',sections:['connection']},
];
const DEFAULT_GROUPS=Object.fromEntries(NAVIGATION_GROUPS.map(group=>[group.id,group.id==='resources'||group.id==='data']));
function groupPreference(value:unknown){const source=value&&typeof value==='object'?value as Record<string,unknown>:{};return Object.fromEntries(NAVIGATION_GROUPS.map(group=>[group.id,typeof source[group.id]==='boolean'?source[group.id] as boolean:DEFAULT_GROUPS[group.id]]));}
function visiblePreference(value:unknown){return typeof value==='boolean'?value:true;}
export function WorkspaceSidebarProvider({account,children}:{account?:string;children:ReactNode}){
  const [open,setOpen]=useBrowserPreference(account?`aslung_menu_visible:${account}`:null,true,visiblePreference);
  return <SidebarProvider id="sidebar-provider" open={open} onOpenChange={setOpen} style={{'--sidebar-width':'245px'} as React.CSSProperties}>{children}</SidebarProvider>;
}
export function SidebarVisibilityButton({isEnglish=false,compact=false}:{isEnglish?:boolean;compact?:boolean}){
  const {open,openMobile,isMobile,toggleSidebar}=useSidebar();const visible=isMobile?openMobile:open;
  const label=isEnglish?(visible?'Hide menu':'Show menu'):(visible?'隱藏選單':'顯示選單');
  return <Button type="button" variant="ghost" size={compact?'icon':'sm'} onClick={toggleSidebar} aria-expanded={visible} aria-controls="workspace-navigation" aria-label={label} title={label} className={compact?'shrink-0 text-slate-300 hover:bg-white/10 hover:text-white':'shrink-0 gap-2'}>{visible?<PanelLeftClose className="size-4"/>:<PanelLeftOpen className="size-4"/>}{!compact&&<span className="hidden sm:inline">{label}</span>}</Button>;
}
type Item={id:string;name:string;icon:ComponentType<any>};
export default function WorkspaceNavigation({items,section,onSelect,account,isEnglish=false}:{items:Item[];section:string;onSelect:(id:string)=>void;account?:string;isEnglish?:boolean}){
  const key=account?`aslung_menu_groups:${account}`:null;
  const [expanded,setExpanded,ready]=useBrowserPreference(key,DEFAULT_GROUPS,groupPreference);
  const {isMobile,setOpenMobile}=useSidebar();
  useEffect(()=>{
    if(!ready)return;const group=NAVIGATION_GROUPS.find(group=>group.sections.includes(section));
    if(group)setExpanded(previous=>previous[group.id]?previous:{...previous,[group.id]:true});
  },[section,key,ready,setExpanded]);
  return <nav className="workspace-nav" aria-label={isEnglish?'Workspace functions':'工作空間功能'}>{NAVIGATION_GROUPS.map(group=>{
    const children=group.sections.flatMap(id=>items.filter(item=>item.id===id));if(!children.length)return null;
    const active=group.sections.includes(section),open=expanded[group.id],control=`menu-group-${group.id}`;
    return <div key={group.id} className="nav-group"><button type="button" className="nav-group-toggle" data-active={active} aria-expanded={open} aria-controls={control} onClick={()=>setExpanded(previous=>({...previous,[group.id]:!previous[group.id]}))}><span>{isEnglish?group.en:group.zh}</span><ChevronDown className={`size-4 shrink-0 transition-transform ${open?'':'-rotate-90'}`}/></button><div id={control} hidden={!open}><SidebarMenu>{children.map(item=><SidebarMenuItem key={item.id}><SidebarMenuButton className="nav-button" isActive={section===item.id} aria-current={section===item.id?'page':undefined} onClick={()=>{onSelect(item.id);if(isMobile)setOpenMobile(false);}}><item.icon/><span>{item.name}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></div></div>;
  })}</nav>;
}
