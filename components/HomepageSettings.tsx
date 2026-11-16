"use client";
import {useEffect,useRef,useState} from 'react';
import {HOMEPAGE_OPTIONS,DEFAULT_HOMEPAGE_SETTINGS} from '@/lib/homepage-options.mjs';
import {HOMEPAGE_CONTENT_SECTIONS,DEFAULT_HOMEPAGE_CONTENT,cloneHomepageContent} from '@/lib/homepage-content.mjs';
import PostEditor from '@/components/PostEditor';
import HomepageBody from '@/components/HomepageBody';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
type Props={api:(url:string,options?:RequestInit)=>Promise<any>;isEnglish:boolean;formatTime:(value:string)=>string};
export default function HomepageSettings({api,isEnglish:en,formatTime}:Props){
 const [snapshot,setSnapshot]=useState<any>(null),[values,setValues]=useState<Record<string,boolean>>({...DEFAULT_HOMEPAGE_SETTINGS}),[content,setContent]=useState<any>(()=>cloneHomepageContent());
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [activeEditor,setActiveEditor]=useState<string|null>(null),[editorEpoch,setEditorEpoch]=useState(0),[uploading,setUploading]=useState(false);
 const locked=busy||uploading;
 const generation=useRef(0);
 async function load(){const id=++generation.current;setLoading(true);setError('');try{const result=await api('/api/homepage-settings');if(id===generation.current){setSnapshot(result);setValues(result.settings);setContent(cloneHomepageContent(result.content));setActiveEditor(null);setEditorEpoch(v=>v+1);setNotice('');}}catch(e){if(id===generation.current)setError((e as Error).message);}finally{if(id===generation.current)setLoading(false);}}
 useEffect(()=>{void load();return()=>{generation.current++;};},[api]);
 const changed=!!snapshot&&(JSON.stringify(values)!==JSON.stringify(snapshot.settings)||JSON.stringify(content)!==JSON.stringify(snapshot.content||DEFAULT_HOMEPAGE_CONTENT));
 function reset(section?:string){if(locked)return;if(!window.confirm(en?'Restore defaults in this draft? Save to publish the reset.':'將草稿恢復預設值？按儲存後才會套用至公開頁面。'))return;
  if(section){setContent((old:any)=>({...old,[section]:cloneHomepageContent()[section]}));if(Object.hasOwn(DEFAULT_HOMEPAGE_SETTINGS,section))setValues(old=>({...old,[section]:DEFAULT_HOMEPAGE_SETTINGS[section]}));}
  else{setValues({...DEFAULT_HOMEPAGE_SETTINGS});setContent(cloneHomepageContent());}
  setActiveEditor(null);setEditorEpoch(v=>v+1);
  setNotice(en?'Defaults restored in the draft. Save to apply.':'已將草稿恢復預設，請儲存以套用。');}
 return <section className="panel p-5 sm:p-7 space-y-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-semibold">{en?'Homepage content and visibility':'首頁內容與區塊設定'}</h2><p className="text-sm text-slate-500 mt-2">{en?'Edit each section name, heading and text in Chinese and English.':'各區塊可重新命名，並分別編輯中英文標題、說明、卡片、流程及按鈕文字。'}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={locked||loading} onClick={()=>{if(!changed||window.confirm(en?'Discard unsaved changes?':'捨棄尚未儲存的變更並重新載入？'))void load();}}>{en?'Reload settings':'重新載入設定'}</Button><Button variant="outline" asChild><a href="/about" target="_blank" rel="noopener noreferrer">{en?'Preview saved page':'開啟已儲存介紹頁'}</a></Button></div></div>
 {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
 {loading?<p role="status">{en?'Loading…':'載入中…'}</p>:snapshot&&<form className="space-y-5" onSubmit={async e=>{e.preventDefault();if(locked)return;setBusy(true);setError('');setNotice('');try{const result=await api('/api/homepage-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings:values,content,version:snapshot.version})});setSnapshot(result);setValues(result.settings);setContent(cloneHomepageContent(result.content));setActiveEditor(null);setEditorEpoch(v=>v+1);setNotice(en?'Saved. Refresh the public page to see the changes.':'已儲存，重新整理公開頁面即可看到變更。');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
  <div className="space-y-3">{HOMEPAGE_CONTENT_SECTIONS.map(section=>{const option=HOMEPAGE_OPTIONS.find(o=>o.key===section.key),label=content[section.key][en?'en':'zh'].label;
   return <details className="rounded-lg border" key={section.key}><summary className="p-4 cursor-pointer font-medium">{label} <span className="text-xs text-slate-500 font-normal">{option?(values[section.key]?(en?'Shown':'顯示'):(en?'Hidden':'隱藏')):(en?'Always visible':'固定顯示')}</span></summary><div className="p-4 pt-0 space-y-4">
    {option&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={values[section.key]} disabled={locked||section.key==='hero_device_label'&&!values.hero_visual} onChange={e=>setValues(old=>({...old,[section.key]:e.target.checked}))}/><span>{en?'Show this section':'顯示此區塊'}<small className="block text-slate-500 mt-1">{en?option.descriptionEn:option.description}</small></span></label>}
    <div className="grid gap-5 lg:grid-cols-2">{(['zh','en'] as const).map(lang=><fieldset disabled={locked} className="space-y-3 min-w-0" key={lang}><legend className="font-semibold mb-3">{lang==='zh'?'繁體中文':'English'}</legend>{section.fields.map(field=>{
     const id=`homepage-${section.key}-${lang}-${field.key}`,value=content[section.key][lang][field.key],change=(v:string)=>setContent((old:any)=>({...old,[section.key]:{...old[section.key],[lang]:{...old[section.key][lang],[field.key]:v}}}));
     if(field.rich){const document=content[section.key][lang].rich?.[field.key];return <div className="space-y-2 text-sm min-w-0" key={field.key}><div className="flex gap-2 justify-between items-center"><strong>{field.label}</strong><Button type="button" variant="outline" size="sm" disabled={locked} onClick={()=>setActiveEditor(activeEditor===id?null:id)}>{activeEditor===id?(en?'Close editor':'收合編輯器'):(en?'Edit formatting':'可視化編輯')}</Button></div>
       {activeEditor===id?<PostEditor key={id+'-'+editorEpoch} context="homepage" label={section.zh+' '+(lang==='zh'?'繁體中文':'English')+' '+field.label} body={value} document={document} disabled={busy} isEnglish={lang==='en'} api={api} onBusy={setUploading} onChange={v=>setContent((old:any)=>({...old,[section.key]:{...old[section.key],[lang]:{...old[section.key][lang],[field.key]:v.body,rich:{...(old[section.key][lang].rich||{}),[field.key]:v.body_json}}}}))}/>:<div className="rounded border bg-slate-50 p-3 max-h-72 overflow-auto"><HomepageBody body={value} document={document}/>{!value&&!document&&<span className="text-slate-400">{en?'Empty':'尚無內容'}</span>}</div>}
     </div>;}
     return <label className="block text-sm" key={field.key} htmlFor={id}>{field.label}{field.multiline?<textarea id={id} className="block w-full rounded-md border bg-white p-2 mt-1" value={value} rows={2} maxLength={field.max} onChange={e=>change(e.target.value)}/>:<Input id={id} value={value} required={field.key==='label'} maxLength={field.max} onChange={e=>change(e.target.value)}/>}</label>;
    })}</fieldset>)}</div>
    <Button type="button" variant="outline" disabled={locked} onClick={()=>reset(section.key)}>{en?'Reset this section (save to apply)':'重設此區塊（需儲存）'}</Button>
   </div></details>;
  })}</div>
  <p className="text-xs leading-6 text-slate-500">{en?'Descriptions use the existing Tiptap editor. Names, headings and button labels remain plain text. Images become public only after saving in a visible section. Reset restores both languages, formatting and default visibility; save to apply.':'說明內容使用 Tiptap 可視化編輯，名稱、標題與按鈕文字維持純文字。圖片只在儲存且區塊啟用後公開。重設會還原中英文、文字格式與預設顯示狀態，按儲存才套用；登入入口及原有權限保留。'}</p>
  <div className="flex flex-wrap gap-2"><Button type="submit" disabled={locked||!changed}>{busy?(en?'Saving…':'儲存中…'):(en?'Save homepage settings':'儲存首頁設定')}</Button><Button type="button" variant="outline" disabled={locked||!changed} onClick={()=>{setValues(snapshot.settings);setContent(cloneHomepageContent(snapshot.content));setActiveEditor(null);setEditorEpoch(v=>v+1);setNotice('');}}>{en?'Discard changes':'取消變更'}</Button><Button type="button" variant="outline" disabled={locked} onClick={()=>reset()}>{en?'Reset all sections (save to apply)':'全部恢復預設（需儲存）'}</Button></div>
  {snapshot.updated_at&&<p className="text-xs text-slate-400">{en?'Last saved':'最後儲存'}：{formatTime(snapshot.updated_at)}</p>}
 </form>}
 </section>;
}
