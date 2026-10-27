"use client";
import {useEffect,useRef,useState} from 'react';
import {formatInTimeZone} from 'date-fns-tz';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {BellRing,FileText,Pin,Plus,ArrowLeft,Search} from 'lucide-react';

type Kind='news'|'article';
type Post={id?:string;kind:Kind;title:string;summary:string;body:string;status:string;pinned:boolean|number;version?:number;author_name?:string;published_at?:string;updated_at?:string};
type Props={api:(url:string,options?:RequestInit)=>Promise<any>;kind:Kind;admin:boolean;timezone:string;isEnglish?:boolean};
export function PostBody({body}:{body:string}){
  return <div className="space-y-4 leading-8 text-slate-700">{body.split(/\n\s*\n/).map((paragraph,index)=><p key={index} className="whitespace-pre-wrap break-words">{paragraph.split(/(https?:\/\/[^\s<>]+)/g).map((part,i)=>/^https?:\/\//.test(part)?<a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-teal-700 underline">{part}</a>:part)}</p>)}</div>;
}
export default function PostsView({api,kind,admin,timezone,isEnglish=false}:Props){
  const t=(zh:string,en:string)=>isEnglish?en:zh;
  const [manage,setManage]=useState(false),[status,setStatus]=useState('all'),[search,setSearch]=useState(''),[q,setQ]=useState(''),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
  const [feed,setFeed]=useState<any>({rows:[],total:0,pages:0}),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [detail,setDetail]=useState<Post|null>(null),[editor,setEditor]=useState<Post|null>(null),[preview,setPreview]=useState(false);
  const generation=useRef(0),actionGeneration=useRef(0),original=useRef('');
  useEffect(()=>{
    const controller=new AbortController(),current=++generation.current;
    setLoading(true);setError('');setFeed({rows:[],total:0,pages:0});
    const params=new URLSearchParams({kind,manage:admin&&manage?'1':'0',status,q,page:String(page)});
    void api('/api/posts?'+params,{signal:controller.signal}).then(result=>{if(current===generation.current)setFeed(result);}).catch(e=>{if(!controller.signal.aborted&&current===generation.current)setError(e.message);}).finally(()=>{if(current===generation.current)setLoading(false);});
    return()=>{controller.abort();generation.current++;};
  },[api,kind,admin,manage,status,q,page,refresh]);
  useEffect(()=>()=>{actionGeneration.current++;},[]);
  const time=(value?:string)=>value?formatInTimeZone(new Date(value),timezone,'yyyy/MM/dd HH:mm'):'—';
  const statusLabel=(value:string)=>value==='published'?t('已發布','Published'):value==='draft'?t('草稿','Draft'):t('已下架','Archived');
  function begin(post?:Post){const draft:Post=post?{...post,pinned:!!post.pinned}:{kind,title:'',summary:'',body:'',status:'draft',pinned:false};original.current=JSON.stringify(draft);setEditor(draft);setPreview(false);setError('');setNotice('');}
  function closeEditor(){if(editor&&JSON.stringify(editor)!==original.current&&!window.confirm(t('尚未儲存的內容將捨棄，確定離開？','Discard your unsaved changes?')))return;setEditor(null);setPreview(false);setError('');}
  async function open(id:string,edit=false){
    const current=++actionGeneration.current;setBusy(true);setError('');setNotice('');
    try{const post=await api('/api/posts?'+new URLSearchParams({id,manage:admin&&manage?'1':'0'}));if(current!==actionGeneration.current)return;if(edit)begin(post);else setDetail(post);}
    catch(e){if(current===actionGeneration.current)setError((e as Error).message);}finally{if(current===actionGeneration.current)setBusy(false);}
  }
  async function save(nextStatus:string){
    if(!editor||busy)return;
    if(nextStatus==='archived'&&!window.confirm(t('下架後會員無法閱讀，日後可重新發布。確定下架？','Archive this post? Members will no longer see it. You can republish it later.')))return;
    setBusy(true);setError('');setNotice('');
    try{await api('/api/posts',{method:'POST',body:JSON.stringify({...editor,status:nextStatus,pinned:!!editor.pinned})});setEditor(null);setDetail(null);setRefresh(value=>value+1);setNotice(nextStatus==='published'?t('已發布，會員可立即閱讀。','Published. Members can read it now.'):nextStatus==='draft'?t('已儲存草稿，僅管理員可見。','Draft saved; visible only to administrators.'):t('已下架。','Archived.'));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const label=kind==='news'?t('最新消息','Latest news'):t('文章專區','Articles');
  const title=<div className="flex items-center gap-2 text-xl font-semibold">{kind==='news'?<BellRing className="size-5"/>:<FileText className="size-5"/>}<h2>{label}</h2></div>;
  const feedback=<>{error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}{notice&&<p role="status" className="rounded-lg bg-teal-50 p-3 text-teal-800">{notice}</p>}</>;
  if(editor)return <section className="panel p-6 space-y-5">{title}<div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{editor.id?t('編輯內容','Edit post'):t('新增內容','New post')}</h3><Button variant="outline" disabled={busy} onClick={closeEditor}><ArrowLeft className="size-4"/>{t('返回','Back')}</Button></div>{feedback}
    <form className="space-y-4" onSubmit={e=>{e.preventDefault();void save('published');}}>
      <label className="block text-sm">{t('標題（最多 160 字）','Title (up to 160 characters)')}<Input required maxLength={160} value={editor.title} disabled={busy} onChange={e=>setEditor({...editor,title:e.target.value})}/></label>
      <label className="block text-sm">{t('摘要（選填，最多 500 字；留白自動擷取內文）','Summary (optional, up to 500 characters; generated from body if blank)')}<Textarea maxLength={500} value={editor.summary} disabled={busy} onChange={e=>setEditor({...editor,summary:e.target.value})}/></label>
      <div className="flex items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!editor.pinned} disabled={busy} onChange={e=>setEditor({...editor,pinned:e.target.checked})}/>{t('置頂顯示','Pin to top')}</label><Button type="button" variant="outline" onClick={()=>setPreview(value=>!value)}>{preview?t('繼續編輯','Continue editing'):t('預覽文章','Preview')}</Button></div>
      {preview?<article className="rounded-lg border bg-slate-50 p-5"><h3 className="mb-4 break-words text-2xl font-semibold">{editor.title}</h3><PostBody body={editor.body}/></article>:<label className="block text-sm">{t('內文（最多 60,000 字）','Body (up to 60,000 characters)')}<Textarea required maxLength={60000} className="mt-1 min-h-80" value={editor.body} disabled={busy} onChange={e=>setEditor({...editor,body:e.target.value})}/></label>}
      <p className="text-xs text-slate-500">{t('保留換行與段落，http/https 網址可點擊。內容僅供登入會員閱讀。儲存草稿會使已發布的貼文暫時下架。','Line breaks and paragraphs are preserved; HTTP/HTTPS links are clickable. Posts are for signed-in members. Saving a published post as a draft hides it from members.')}</p>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy||!editor.title.trim()||!editor.body.trim()}>{busy?t('儲存中…','Saving…'):t('儲存並發布','Save and publish')}</Button><Button type="button" variant="outline" disabled={busy||!editor.title.trim()||!editor.body.trim()} onClick={()=>void save('draft')}>{t('儲存草稿','Save draft')}</Button>{editor.id&&editor.status!=='archived'&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void save('archived')}>{t('下架','Archive')}</Button>}</div>
    </form></section>;
  if(detail)return <section className="panel p-6 space-y-5">{feedback}<div className="flex flex-wrap justify-between gap-3"><Button variant="outline" onClick={()=>{setDetail(null);setRefresh(value=>value+1);}}><ArrowLeft className="size-4"/>{t('返回清單','Back to list')}</Button>{admin&&manage&&<Button disabled={busy} onClick={()=>begin(detail)}>{t('編輯','Edit')}</Button>}</div><article><div className="mb-3 text-sm text-slate-500">{detail.pinned?`${t('置頂','Pinned')} · `:''}{statusLabel(detail.status)} · {time(detail.published_at||detail.updated_at)} ({timezone}) · {detail.author_name}</div><h2 className="mb-6 break-words text-3xl font-semibold">{detail.title}</h2><PostBody body={detail.body}/></article></section>;
  return <section className="panel p-6 space-y-5"><div className="flex flex-wrap items-center justify-between gap-3">{title}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading||busy} onClick={()=>setRefresh(value=>value+1)}>{t('重新整理','Refresh')}</Button>{admin&&<><Button variant="outline" disabled={busy} onClick={()=>{setManage(value=>!value);setPage(1);setStatus('all');}}>{manage?t('查看發布內容','Reader view'):t('管理發布','Manage posts')}</Button><Button disabled={busy} onClick={()=>{setManage(true);begin();}}><Plus className="size-4"/>{t('新增','New post')}</Button></>}</div></div>
    <p className="text-sm text-slate-500">{manage?t('管理草稿、已發布及已下架內容。置頂內容優先顯示，其餘依首次發布時間排序。','Manage draft, published and archived posts. Pinned posts appear first, then newest publication.'):t('網站公告與分享內容；點選標題閱讀全文。','Announcements and shared articles. Select a title to read the full post.')}</p>{feedback}
    <form className="flex flex-wrap gap-3" onSubmit={e=>{e.preventDefault();setQ(search.trim());setPage(1);setRefresh(value=>value+1);}}><Input aria-label={t('搜尋內容','Search posts')} className="max-w-sm" value={search} maxLength={160} onChange={e=>setSearch(e.target.value)} placeholder={t('搜尋標題、摘要或內文','Search title, summary or body')}/>{manage&&<select aria-label={t('發布狀態','Publication status')} className="rounded border bg-white px-3 text-sm" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>{['all','draft','published','archived'].map(value=><option key={value} value={value}>{value==='all'?t('全部狀態','All statuses'):statusLabel(value)}</option>)}</select>}<Button type="submit" variant="outline"><Search className="size-4"/>{t('搜尋','Search')}</Button></form>
    {loading?<p role="status">{t('載入中…','Loading…')}</p>:<><p className="text-sm text-slate-500">{t(`共 ${feed.total} 篇`,`Total: ${feed.total} posts`)}</p><div className="space-y-3">{feed.rows.map((post:Post)=><article key={post.id} className="rounded-xl border bg-white p-5"><div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">{!!post.pinned&&<span className="inline-flex items-center gap-1 rounded bg-teal-50 px-2 py-1 text-teal-800"><Pin className="size-3"/>{t('置頂','Pinned')}</span>}{manage&&<span>{statusLabel(post.status)}</span>}<time>{time(post.published_at||post.updated_at)} ({timezone})</time><span>{post.author_name}</span></div><button className="mt-3 text-left text-xl font-semibold break-words text-slate-900 hover:text-teal-700 hover:underline disabled:opacity-60" disabled={busy} onClick={()=>void open(post.id!)}>{post.title}</button><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{post.summary}</p>{manage&&<Button className="mt-3" size="sm" variant="outline" disabled={busy} onClick={()=>void open(post.id!,true)}>{t('編輯／發布設定','Edit / publication settings')}</Button>}</article>)}</div>{!feed.rows.length&&!error&&<p className="rounded-lg bg-slate-50 p-8 text-center text-slate-500">{q?t('沒有符合搜尋條件的內容。','No posts match your search.'):t('目前沒有可顯示的內容。','There are no posts to display.')}</p>}<div className="flex items-center gap-3"><Button variant="outline" disabled={page<=1||busy} onClick={()=>setPage(value=>value-1)}>{t('上一頁','Previous')}</Button><span className="text-sm">{page} / {Math.max(1,feed.pages)}</span><Button variant="outline" disabled={page>=feed.pages||busy} onClick={()=>setPage(value=>value+1)}>{t('下一頁','Next')}</Button></div></>}
  </section>;
}
