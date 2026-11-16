"use client";
import {useEffect,useRef,useState} from 'react';
import {formatInTimeZone,fromZonedTime} from 'date-fns-tz';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import GuestFilesAdmin from '@/components/GuestFilesAdmin';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
type Props={api:(url:string,options?:RequestInit)=>Promise<any>;timezone:string;isEnglish:boolean};
const rightNames=[['view','檢視','View'],['download','下載','Download'],['manage','管理','Manage'],['grant','授權','Share']];
export default function FileManager({api,timezone,isEnglish:en}:Props){
  const [guestFile,setGuestFile]=useState<any>(null);
  const [data,setData]=useState<any>(null),[folder,setFolder]=useState('all'),[page,setPage]=useState(1),[search,setSearch]=useState(''),[query,setQuery]=useState('');
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [dialog,setDialog]=useState(''),[editing,setEditing]=useState<any>(null),[resource,setResource]=useState<any>(null),[permissionData,setPermissionData]=useState<any>(null),[permissionLoading,setPermissionLoading]=useState(false);
  const [subjectType,setSubjectType]=useState('user'),[selectedRights,setSelectedRights]=useState<Record<string,boolean>>({view:true,download:false,manage:false,grant:false});
  const [groupEmails,setGroupEmails]=useState<Set<string>>(new Set()),[memberSearch,setMemberSearch]=useState('');
  const requestId=useRef(0),permissionRequest=useRef(0);
  async function reload(){
    const id=++requestId.current;setLoading(true);
    try{const result=await api('/api/files?'+new URLSearchParams({folder,q:query,page:String(page)}));if(id===requestId.current){setData(result);setError('');}}
    catch(e){if(id===requestId.current){setData(null);setError((e as Error).message);}}
    finally{if(id===requestId.current)setLoading(false);}
  }
  useEffect(()=>{void reload();return()=>{requestId.current++;};},[folder,query,page]);
  useEffect(()=>{const refresh=()=>void reload();window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[folder,query,page]);
  async function post(body:any){return api('/api/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
  function close(){permissionRequest.current++;setDialog('');setError('');}
  function open(kind:string,value:any=null){setEditing(value);setDialog(kind);setError('');setNotice('');if(kind==='group'){setGroupEmails(new Set(value?.emails||[]));setMemberSearch('');}}
  async function loadPermissions(target:any){
    const id=++permissionRequest.current;setPermissionLoading(true);
    try{const result=await api('/api/files?'+new URLSearchParams({action:'permissions',resource_type:target.type,resource_id:target.id}));if(id===permissionRequest.current)setPermissionData(result);}
    catch(e){if(id===permissionRequest.current){setPermissionData(null);setError((e as Error).message);}}
    finally{if(id===permissionRequest.current)setPermissionLoading(false);}
  }
  function share(target:any){setResource(target);setPermissionData(null);setSubjectType('user');setSelectedRights({view:true,download:false,manage:false,grant:false});open('permission');void loadPermissions(target);}
  async function remove(body:any,message:string){
    if(!window.confirm(message))return false;setBusy(true);setError('');
    try{await post(body);setNotice(en?'Updated.':'已更新。');if(body.action==='permissionDelete')await loadPermissions(resource);if(body.action==='folderDelete'){setFolder('all');setPage(1);}else await reload();return true;}
    catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}
  }
  const current=data?.folders.find((row:any)=>row.id===folder),manageableFolders=(data?.folders||[]).filter((row:any)=>row.permissions.manage),canManage=folder==='all'?manageableFolders.length>0:!!current?.permissions.manage;
  const localTime=(value:string)=>value?formatInTimeZone(new Date(value),timezone,'yyyy/MM/dd HH:mm:ss'):(en?'No expiry':'不設到期時間');
  const titles:Record<string,string>={folder:editing?(en?'Rename folder':'更名資料夾'):(en?'New folder':'新增資料夾'),group:editing?(en?'Edit member group':'編輯會員群組'):(en?'New member group':'新增會員群組'),upload:en?'Upload file':'上傳檔案',link:en?'Add external link':'新增外部連結',file:en?'Edit file':'編輯檔案',permission:en?'Permissions':'授權設定'};
  return <div className="space-y-5">
    {notice&&<p role="status" className="text-sm text-teal-800">{notice}</p>}
    {error&&!dialog&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <section className="panel p-5 space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm">{en?'Folder':'資料夾'}<select aria-label={en?'File folder':'檔案資料夾'} className="block h-10 rounded border bg-white px-3 min-w-44" value={folder} onChange={event=>{setFolder(event.target.value);setPage(1);}}><option value="all">{en?'All categories':'全部分類'}</option><option value="root">{en?'Unfiled':'未分類'}</option>{data?.folders.filter((row:any)=>row.id!=='root').map((row:any)=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <form className="flex items-end gap-2" onSubmit={event=>{event.preventDefault();setPage(1);setQuery(search);}}><label className="text-sm">{en?'Find files':'搜尋檔案'}<Input value={search} maxLength={160} onChange={event=>setSearch(event.target.value)}/></label><Button variant="outline" disabled={loading}>{en?'Search':'搜尋'}</Button></form>
        <Button variant="outline" disabled={loading} onClick={()=>void reload()}>{en?'Refresh':'重新整理'}</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {data?.isAdmin&&<Button variant="outline" onClick={()=>open('folder')}>{en?'New folder':'新增資料夾'}</Button>}
        {current?.permissions.manage&&folder!=='root'&&<Button variant="outline" onClick={()=>open('folder',current)}>{en?'Rename folder':'更名資料夾'}</Button>}
        {current?.permissions.grant&&<Button variant="outline" onClick={()=>share({type:'folder',id:folder,name:current.name})}>{en?'Folder permissions':'資料夾授權'}</Button>}
        {canManage&&<><Button onClick={()=>open('upload')}>{en?'Upload file':'上傳檔案'}</Button><Button variant="outline" onClick={()=>open('link')}>{en?'External link':'新增外部連結'}</Button></>}
        {data?.isAdmin&&folder!=='root'&&folder!=='all'&&<Button variant="outline" disabled={!!data.total||busy} onClick={()=>void remove({action:'folderDelete',id:folder},en?'Delete this empty folder and its permissions?':'刪除此空資料夾及其授權？')}>{en?'Delete empty folder':'刪除空資料夾'}</Button>}
      </div>
      <p className="text-xs leading-6 text-slate-500 break-words">{en?'New files inherit folder permissions. File-specific grants add access. Other permissions imply visibility, but managing and sharing do not automatically allow downloads. Only administrators may move files between folders because inherited permissions change.':'新檔案繼承資料夾授權；個別檔案可另外授權。下載、管理或授權權限均包含可見清單，但管理與授權不自動包含下載。跨資料夾移動會改變繼承授權，僅管理員可執行。'}</p>
    </section>
    <section className="panel p-5">
      <h2 className="font-semibold mb-3">{folder==='all'?(en?'All categories':'全部分類'):current?.name|| (en?'Files':'檔案')} · {data?.total??0}</h2>
      {loading&&<p role="status">{en?'Loading…':'載入中…'}</p>}
      {data&&<><div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{(en?['File','Size / link','My permissions','Actions']:['檔案','大小／連結','我的權限','操作']).map(label=><th className="p-3 whitespace-nowrap" key={label}>{label}</th>)}</tr></thead><tbody>{data.files.map((file:any)=><tr key={file.id} className="border-t">
        <td className="p-3 min-w-44"><strong>{file.name}</strong>{folder==='all'&&<p className="text-xs text-teal-700">{en?'Category: ':'分類：'}{file.folder_name||data.folders.find((f:any)=>f.id===file.folder_id)?.name||'未分類'}</p>}<p className="text-xs text-slate-500 whitespace-pre-wrap">{file.description}</p><p className="text-xs text-slate-400">{localTime(file.created_at)}</p></td>
        <td className="p-3 whitespace-nowrap text-xs">{file.external?(en?'External link':'外部連結'):(file.size/1024).toFixed(1)+' KB'}<p>{en?'Downloads':'下載次數'}：{file.download_count}</p></td>
        <td className="p-3 text-xs">{rightNames.filter(([key])=>file.permissions[key]).map(([key,zh,label])=><span key={key} className="inline-block mr-1 mb-1 rounded bg-teal-50 px-2 py-1 text-teal-800">{en?label:zh}</span>)}</td>
        <td className="p-3"><div className="flex flex-wrap gap-2 min-w-56">
          {file.permissions.view&&file.previewable&&<Button size="sm" variant="outline" asChild><a href={'/api/files?id='+encodeURIComponent(file.id)+'&view=1'} target="_blank" rel="noopener noreferrer">{en?'Preview':'預覽'}</a></Button>}
          {file.permissions.download&&<Button size="sm" variant="outline" asChild><a href={'/api/files?id='+encodeURIComponent(file.id)+'&download=1'} target="_blank" rel="noopener noreferrer">{file.external?(en?'Open original link':'開啟原始連結'):(en?'Download original':'下載原檔')}</a></Button>}
          {file.permissions.manage&&<><Button size="sm" variant="outline" onClick={()=>open('file',file)}>{en?'Edit':'編輯'}</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>void remove({action:'fileDelete',id:file.id},en?'Permanently delete this file and its permissions?':'永久刪除此檔案及其授權？此階段尚無回收桶。')}>{en?'Delete':'刪除'}</Button></>}
          {file.permissions.grant&&<Button size="sm" variant="outline" onClick={()=>share({type:'file',id:file.id,name:file.name})}>{en?'Permissions':'授權'}</Button>}
          {data?.isAdmin&&<Button size="sm" variant="outline" onClick={()=>setGuestFile(file)}>{en?'Guest sharing':'訪客分享'}</Button>}
        </div>{!file.previewable&&!file.permissions.download&&<p className="text-xs text-slate-500 mt-2">{en?'Metadata only; this format requires permission to download the original.':'目前僅可查看檔案資訊；此格式需下載權限才能取得原檔。'}</p>}</td>
      </tr>)}</tbody></table></div>{!data.files.length&&<p className="py-6 text-sm text-slate-500">{en?'No files match your current permissions and search.':'目前沒有符合授權與搜尋條件的檔案。'}</p>}
      <div className="flex gap-3 items-center mt-4"><Button variant="outline" disabled={loading||page<=1} onClick={()=>setPage(value=>value-1)}>{en?'Previous':'上一頁'}</Button><span className="text-sm">{page} / {Math.max(data.pages,1)}</span><Button variant="outline" disabled={loading||page>=data.pages} onClick={()=>setPage(value=>value+1)}>{en?'Next':'下一頁'}</Button></div></>}
    </section>
    {data?.isAdmin&&<section className="panel p-5 space-y-3"><div className="flex flex-wrap justify-between items-center gap-3"><h2 className="font-semibold">{en?'Member groups':'會員群組'}</h2><Button variant="outline" onClick={()=>open('group')}>{en?'New group':'新增群組'}</Button></div><p className="text-xs text-slate-500">{en?'Groups do not grant access automatically. Assign folder or file permissions to a group. Removing members immediately removes group-derived access and dependent shares.':'建立群組不會自動開通檔案權限，仍須將群組加入資料夾或檔案授權。移出群組後，群組取得的權限與依賴它的轉授會立即失效。'}</p>
      {data.groups.map((group:any)=><div className="flex flex-wrap justify-between gap-3 border-t py-3" key={group.id}><div><strong>{group.name}</strong><p className="text-xs text-slate-500">{group.emails.length} {en?'members':'位會員'}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>open('group',group)}>{en?'Edit members':'編輯成員'}</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>void remove({action:'groupDelete',id:group.id},en?'Delete this group? All its permissions and dependent shares will be revoked.':'刪除此群組？群組授權與依賴它的轉授都將撤銷。')}>{en?'Delete':'刪除'}</Button></div></div>)}
    </section>}
    {data?.isAdmin&&<details className="panel p-5"><summary className="cursor-pointer font-semibold">訪客申請審核與下載紀錄（所有檔案）</summary><div className="mt-4"><GuestFilesAdmin api={api} timezone={timezone}/></div></details>}
    {data?.isAdmin&&<Dialog open={!!guestFile} onOpenChange={open=>{if(!open)setGuestFile(null);}}><DialogContent className="max-h-[90vh] overflow-auto sm:max-w-5xl"><DialogHeader><DialogTitle>訪客分享</DialogTitle><DialogDescription>{guestFile?.name}</DialogDescription></DialogHeader>{guestFile&&<GuestFilesAdmin key={guestFile.id} api={api} timezone={timezone} file={guestFile}/>}</DialogContent></Dialog>}
    <Dialog open={!!dialog} onOpenChange={value=>{if(!value&&!busy)close();}}><DialogContent className="max-h-[90vh] overflow-auto min-w-0 sm:max-w-3xl [&>*]:min-w-0"><DialogHeader><DialogTitle>{titles[dialog]}</DialogTitle><DialogDescription>{dialog==='permission'?resource?.name:en?'Changes are checked against your current permissions.':'儲存時會重新確認您的目前權限。'}</DialogDescription></DialogHeader>
      {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
      <form className="space-y-4 min-w-0 [&_input]:min-w-0 [&_select]:min-w-0 [&_label]:min-w-0" onSubmit={async event=>{
        event.preventDefault();const form=event.currentTarget,values=Object.fromEntries(new FormData(form));setBusy(true);setError('');
        try{
          if(dialog==='upload'){
            const payload=new FormData(form),file=payload.get('file');if(!(file instanceof File)||file.size>10*1024*1024)throw new Error(en?'Choose a file up to 10 MB.':'請選擇不超過 10 MB 的檔案。');
            await api('/api/files?folder='+encodeURIComponent(String(values.folder_id||folder)),{method:'POST',body:payload});
          }else if(dialog==='link')await post({action:'fileLink',...values,folder_id:String(values.folder_id||folder),emails:[]});
          else if(dialog==='folder')await post({action:'folderSave',id:editing?.id,revision:editing?.revision,name:values.name});
          else if(dialog==='group')await post({action:'groupSave',id:editing?.id,revision:editing?.revision,name:values.name,emails:[...groupEmails]});
          else if(dialog==='file')await post({action:'fileUpdate',id:editing.id,name:values.name,description:values.description,folder_id:values.folder_id||editing.folder_id});
          else if(dialog==='permission'){
            const date=(value:FormDataEntryValue|undefined)=>value?fromZonedTime(String(value),timezone).toISOString():null;
            await post({action:'permissionSave',resource_type:resource.type,resource_id:resource.id,subject_type:subjectType,subject_id:values.subject_id,permissions:selectedRights,valid_from:date(values.valid_from),valid_until:date(values.valid_until)});
            setNotice(en?'Permission added.':'已新增授權。');form.reset();await loadPermissions(resource);await reload();return;
          }
          setNotice(en?'Saved.':'已儲存。');setDialog('');setPage(1);await reload();
        }catch(e){setError((e as Error).message);}finally{setBusy(false);}
      }}>
        {['folder','group','file','link'].includes(dialog)&&<label className="block text-sm">{en?'Name':'名稱'}<Input name="name" defaultValue={editing?.name||''} maxLength={['folder','group'].includes(dialog)?120:255} required/></label>}
        {dialog==='link'&&<label className="block text-sm">{en?'Original HTTP(S) URL':'原始 HTTP(S) 網址'}<Input type="url" name="url" required maxLength={4096}/></label>}
        {dialog==='upload'&&<label className="block text-sm">{en?'File (up to 10 MB)':'檔案（上限 10 MB）'}<Input type="file" name="file" required/></label>}
        {['file','upload','link'].includes(dialog)&&<label className="block text-sm">{en?'Description':'說明'}<Input name="description" maxLength={2000} defaultValue={editing?.description||''}/></label>}
        {['upload','link'].includes(dialog)&&<label className="block text-sm">{en?'Destination category':'存放分類'}<select name="folder_id" required className="block w-full h-10 border rounded px-2" defaultValue={folder==='all'?'':folder}><option value="">{en?'Choose a category':'請選擇存放分類'}</option>{manageableFolders.map((row:any)=><option key={row.id} value={row.id}>{row.name}</option>)}</select><span className="text-xs text-slate-500">{en?'New files inherit the selected category permissions.':'新增檔案會繼承所選分類的授權。'}</span></label>}
        {dialog==='file'&&data?.isAdmin&&<label className="block text-sm">{en?'Destination folder':'存放資料夾'}<select name="folder_id" className="block h-10 border rounded w-full px-2" defaultValue={editing.folder_id}>{data.folders.map((row:any)=><option key={row.id} value={row.id}>{row.name}</option>)}</select><span className="text-xs text-amber-800">{en?'Moving changes inherited folder access; individual file grants stay with the file.':'移動會改採目的資料夾的授權，個別檔案授權則隨檔案保留。'}</span></label>}
        {dialog==='group'&&<><p className="text-xs text-amber-800">{en?'This group is shared with feature access settings. Changing membership affects both menu access and file permissions.':'此群組與功能存取設定共用；成員異動會同時影響選單功能與檔案權限。'}</p><Input aria-label={en?'Find members':'搜尋會員'} placeholder={en?'Find by email':'搜尋會員 Email'} value={memberSearch} onChange={event=>setMemberSearch(event.target.value)}/><div className="max-h-64 overflow-auto border rounded p-3 space-y-2">{data.members.filter((member:any)=>member.email.toLowerCase().includes(memberSearch.toLowerCase())).map((member:any)=><label key={member.email} className="flex gap-2 items-center text-sm"><input type="checkbox" checked={groupEmails.has(member.email)} disabled={!member.active&&!groupEmails.has(member.email)} onChange={event=>setGroupEmails(previous=>{const next=new Set(previous);if(event.target.checked)next.add(member.email);else next.delete(member.email);return next;})}/>{member.email} {!member.active&&(en?'(disabled)':'（已停用）')}</label>)}</div></>}
        {dialog==='permission'&&<>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-sm">{en?'Recipient type':'授權對象'}<select className="block w-full h-10 border rounded px-2" value={subjectType} onChange={event=>setSubjectType(event.target.value)}><option value="user">{en?'Member':'個別會員'}</option><option value="group">{en?'Member group':'會員群組'}</option></select></label>
            <label className="text-sm">{subjectType==='user'?'Email':en?'Group':'群組'}{subjectType==='user'?<Input key="user" name="subject_id" type="email" list="file-share-members" required maxLength={254}/>:<select key="group" name="subject_id" required className="block h-10 w-full border rounded px-2"><option value="">{en?'Choose a group':'請選擇群組'}</option>{permissionData?.groups.map((group:any)=><option key={group.id} value={group.id}>{group.name}</option>)}</select>}</label>
          </div><datalist id="file-share-members">{data?.members.map((member:any)=><option key={member.email} value={member.email}/>)}</datalist>
          <div className="flex flex-wrap gap-4">{rightNames.map(([key,zh,label])=><label className="flex gap-2 items-center text-sm" key={key}><input type="checkbox" checked={selectedRights[key]} onChange={event=>setSelectedRights(previous=>({...previous,[key]:event.target.checked}))}/>{en?label:zh}</label>)}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-sm">{en?'Starts (blank = now)':'生效時間（空白為立即）'}<Input type="datetime-local" step={1} name="valid_from"/></label><label className="text-sm">{en?'Expires (blank = no expiry)':'到期時間（空白為不限期）'}<Input type="datetime-local" step={1} name="valid_until"/></label></div>
          <p className="text-xs leading-6 text-slate-500 break-words">{en?'Times use':'時間使用'} {timezone}。{en?'Sharing cannot exceed the rights or expiry of your own grant. Removing its source revokes dependent shares. Preview cannot prevent saving or screenshots; external originals require download permission.':'轉授不得超過自身權限或期限；上層授權失效時，依賴的轉授也會失效。預覽無法保證防止另存或截圖，外部原始連結需下載權限。'}</p>
          {permissionLoading&&<p role="status">{en?'Loading permissions…':'載入授權中…'}</p>}
          {permissionData&&<div className="overflow-auto max-h-64"><table className="w-full text-left text-xs"><thead><tr>{(en?['Recipient','Rights','Validity','Actions']:['對象','權限','有效期間','操作']).map(label=><th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{permissionData.permissions.map((row:any)=><tr key={row.id} className="border-t"><td className="p-2">{row.user_email||permissionData.groups.find((group:any)=>group.id===row.group_id)?.name||row.group_id}{row.inherited&&<p className="text-slate-400">{en?'From folder':'繼承自資料夾'}</p>}</td><td className="p-2">{rightNames.filter(([key])=>row['can_'+key]).map(([,zh,label])=>en?label:zh).join('、')}</td><td className="p-2 whitespace-nowrap">{localTime(row.valid_from)}<br/>{localTime(row.valid_until)}<p className={row.active?'text-teal-700':'text-slate-500'}>{row.active?(en?'Active':'目前有效'):(en?'Inactive':'目前無效')}</p></td><td className="p-2">{row.canRevoke&&<Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void remove({action:'permissionDelete',id:row.id},en?'Revoke this permission and dependent shares?':'撤銷此授權與依賴它的轉授？')}>{en?'Revoke':'撤銷'}</Button>}</td></tr>)}</tbody></table></div>}
        </>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={close}>{en?'Close':'關閉'}</Button><Button type="submit" disabled={busy||permissionLoading}>{busy?(en?'Saving…':'儲存中…'):dialog==='permission'?(en?'Add permission':'新增授權'):(en?'Save':'儲存')}</Button></div>
      </form>
    </DialogContent></Dialog></div>;
}
