"use client";
import {useEffect,useRef,useState} from 'react';
import {useEditor,EditorContent} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {TextStyleKit} from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import {TableKit} from '@tiptap/extension-table';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import {POST_FONTS,POST_SIZES,plainPostDocument,safePostLink,postImageId} from '@/lib/post-document.mjs';
import {Button} from '@/components/ui/button';
type Props={body:string;document?:string|null;disabled:boolean;isEnglish:boolean;api:(url:string,options?:RequestInit)=>Promise<any>;onChange:(value:{body:string;body_json:string})=>void;onBusy:(busy:boolean)=>void};
const LocalImage=Image.extend({parseHTML(){return [{tag:'img[src]',getAttrs:(element:HTMLElement)=>{try{postImageId(element.getAttribute('src'));return null;}catch{return false;}}}];}});
export default function PostEditor({body,document,disabled,isEnglish:en,api,onChange,onBusy}:Props){
  const [uploading,setUploading]=useState(false),[error,setError]=useState(''),[imageAlt,setImageAlt]=useState(''),[caption,setCaption]=useState('');
  const input=useRef<HTMLInputElement>(null),uploadLock=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  let initial:any;try{initial=document?JSON.parse(document):plainPostDocument(body);}catch{initial=plainPostDocument(body);}
  const editor=useEditor({
    extensions:[StarterKit.configure({heading:{levels:[1,2,3,4]},link:{openOnClick:false,isAllowedUri:value=>{try{safePostLink(value);return true;}catch{return false;}}}}),TextStyleKit.configure({lineHeight:false}),TextAlign.configure({types:['heading','paragraph']}),LocalImage.configure({allowBase64:false,resize:{enabled:true,alwaysPreserveAspectRatio:true,minWidth:32,minHeight:32}}),TableKit.configure({table:{resizable:false}}),Subscript,Superscript],
    content:initial,immediatelyRender:false,shouldRerenderOnTransaction:true,
    editorProps:{attributes:{class:'post-rich-content min-h-80 p-4 outline-none',role:'textbox','aria-label':en?'Post body':'文章內文','aria-multiline':'true'},
      handlePaste:(_view,event)=>{const files=Array.from(event.clipboardData?.files||[]);if(!files.length)return false;event.preventDefault();void upload(files);return true;},
      handleDrop:(_view,event,_slice,moved)=>{if(moved)return false;const files=Array.from(event.dataTransfer?.files||[]);if(!files.length)return false;event.preventDefault();void upload(files);return true;},
    },
    onUpdate:({editor})=>onChange({body:editor.getText({blockSeparator:'\n\n'}).trim()||(!editor.isEmpty?'[圖片]':''),body_json:JSON.stringify(editor.getJSON())}),
  });
  useEffect(()=>{editor?.setEditable(!disabled&&!uploading);},[editor,disabled,uploading]);
  async function upload(files:File[]){
    if(!editor||disabled||uploadLock.current)return;uploadLock.current=true;setUploading(true);onBusy(true);setError('');
    try{
      if(files.length>10)throw new Error(en?'Upload up to 10 images at a time.':'每次最多插入 10 張圖片。');
      for(const file of files){
        if(!alive.current||editor.isDestroyed)break;
        if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error(en?'Choose PNG, JPEG or WebP images up to 5 MB.':'請選擇 5 MB 以內的 PNG、JPEG 或 WebP 圖片。');
        const payload=new FormData();payload.set('file',file);
        const result=await api('/api/posts/images',{method:'POST',body:payload});
        if(!alive.current||editor.isDestroyed)break;
        editor.chain().focus().setImage({src:result.src,alt:imageAlt||file.name,title:imageAlt||undefined,width:Math.min(result.width,800)}).run();
        if(caption)editor.chain().insertContent({type:'paragraph',content:[{type:'text',text:caption}]}).run();
      }
    }catch(e){if(alive.current)setError((e as Error).message);}
    finally{uploadLock.current=false;if(alive.current){setUploading(false);onBusy(false);}if(input.current)input.current.value='';}
  }
  if(!editor)return <p role="status">{en?'Loading editor…':'載入編輯器…'}</p>;
  const locked=disabled||uploading;
  const tool=(zh:string,english:string,action:()=>void,active=false)=> <Button key={english} type="button" size="sm" variant={active?'default':'outline'} disabled={locked} aria-label={en?english:zh} aria-pressed={active} onMouseDown={event=>event.preventDefault()} onClick={action}>{en?english:zh}</Button>;
  return <div className="rounded-lg border bg-white overflow-hidden">
    <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 p-3" role="toolbar" aria-label={en?'Post formatting':'文章格式工具'}>
      <select aria-label={en?'Paragraph style':'段落樣式'} disabled={locked} className="h-9 border rounded px-2 max-w-full" value={editor.isActive('heading')?'h'+editor.getAttributes('heading').level:'paragraph'} onChange={event=>{const v=event.target.value;if(v==='paragraph')editor.chain().focus().setParagraph().run();else editor.chain().focus().toggleHeading({level:Number(v.slice(1)) as 1|2|3|4}).run();}}><option value="paragraph">{en?'Paragraph':'一般段落'}</option>{[1,2,3,4].map(level=><option key={level} value={'h'+level}>{en?'Heading':'標題'} {level}</option>)}</select>
      <select aria-label={en?'Font family':'字型'} disabled={locked} className="h-9 border rounded px-2 max-w-44" value={editor.getAttributes('textStyle').fontFamily||''} onChange={event=>{const chain=editor.chain().focus();if(event.target.value)chain.setFontFamily(event.target.value).run();else chain.unsetFontFamily().run();}}><option value="">{en?'Default font':'預設字型'}</option>{POST_FONTS.map(font=><option key={font} value={font}>{font}</option>)}</select>
      <select aria-label={en?'Font size':'字級'} disabled={locked} className="h-9 border rounded px-2" value={editor.getAttributes('textStyle').fontSize||''} onChange={event=>{const chain=editor.chain().focus();if(event.target.value)chain.setFontSize(event.target.value).run();else chain.unsetFontSize().run();}}><option value="">{en?'Default size':'預設字級'}</option>{POST_SIZES.map(size=><option key={size}>{size}</option>)}</select>
      {tool('粗體','Bold',()=>editor.chain().focus().toggleBold().run(),editor.isActive('bold'))}{tool('斜體','Italic',()=>editor.chain().focus().toggleItalic().run(),editor.isActive('italic'))}{tool('底線','Underline',()=>editor.chain().focus().toggleUnderline().run(),editor.isActive('underline'))}{tool('刪除線','Strikethrough',()=>editor.chain().focus().toggleStrike().run(),editor.isActive('strike'))}
      <label className="text-xs flex gap-1 items-center">{en?'Text color':'文字色'}<input aria-label={en?'Text color':'文字顏色'} type="color" disabled={locked} className="h-8 w-9" defaultValue="#334155" onChange={event=>editor.chain().focus().setColor(event.target.value).run()}/></label>
      <label className="text-xs flex gap-1 items-center">{en?'Highlight':'底色'}<input aria-label={en?'Highlight color':'文字底色'} type="color" disabled={locked} className="h-8 w-9" defaultValue="#fef08a" onChange={event=>editor.chain().focus().setBackgroundColor(event.target.value).run()}/></label>
      {tool('上標','Superscript',()=>editor.chain().focus().toggleSuperscript().run(),editor.isActive('superscript'))}{tool('下標','Subscript',()=>editor.chain().focus().toggleSubscript().run(),editor.isActive('subscript'))}
      {tool('項目符號','Bullet list',()=>editor.chain().focus().toggleBulletList().run(),editor.isActive('bulletList'))}{tool('編號清單','Numbered list',()=>editor.chain().focus().toggleOrderedList().run(),editor.isActive('orderedList'))}{tool('引用','Quote',()=>editor.chain().focus().toggleBlockquote().run(),editor.isActive('blockquote'))}
      {(['left','center','right','justify'] as const).map((align,index)=>tool(['靠左','置中','靠右','左右對齊'][index],align,()=>editor.chain().focus().setTextAlign(align).run(),editor.isActive({textAlign:align})))}
      {tool('連結','Link',()=>{const href=window.prompt(en?'HTTP(S) URL (blank removes link)':'HTTP(S) 網址（留白移除連結）',editor.getAttributes('link').href||'');if(href===null)return;try{if(href)editor.chain().focus().extendMarkRange('link').setLink({href:safePostLink(href)}).run();else editor.chain().focus().unsetLink().run();setError('');}catch(e){setError((e as Error).message);}},editor.isActive('link'))}
      {tool('插入表格','Insert table',()=>editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run())}
      {editor.isActive('table')&&<>{tool('加列','Add row',()=>editor.chain().focus().addRowAfter().run())}{tool('加欄','Add column',()=>editor.chain().focus().addColumnAfter().run())}{tool('刪列','Delete row',()=>editor.chain().focus().deleteRow().run())}{tool('刪欄','Delete column',()=>editor.chain().focus().deleteColumn().run())}{tool('刪表格','Delete table',()=>editor.chain().focus().deleteTable().run())}</>}
      <select aria-label={en?'Insert symbol':'插入符號'} value="" disabled={locked} className="h-9 border rounded px-2" onChange={event=>editor.chain().focus().insertContent(event.target.value).run()}><option value="">{en?'Symbols':'常用符號'}</option>{['μg/m³','°C','±','×','÷','≤','≥','→','α','β','CO₂','PM₂.₅','✓','★','●'].map(symbol=><option key={symbol}>{symbol}</option>)}</select>
      {tool('清除格式','Clear formatting',()=>editor.chain().focus().unsetAllMarks().clearNodes().run())}{tool('復原','Undo',()=>editor.chain().focus().undo().run())}{tool('重做','Redo',()=>editor.chain().focus().redo().run())}
    </div>
    <div className="flex flex-wrap gap-2 items-end border-b p-3 bg-slate-50"><label className="text-xs">{en?'Image alt text':'圖片替代文字'}<input className="block h-9 border rounded px-2 max-w-full" maxLength={500} value={imageAlt} disabled={locked} onChange={event=>setImageAlt(event.target.value)}/></label><label className="text-xs">{en?'Caption (optional)':'圖說（選填）'}<input className="block h-9 border rounded px-2 max-w-full" maxLength={500} value={caption} disabled={locked} onChange={event=>setCaption(event.target.value)}/></label><Button type="button" size="sm" variant="outline" disabled={locked} onClick={()=>input.current?.click()}>{uploading?(en?'Uploading…':'上傳中…'):(en?'Insert image':'插入圖片')}</Button><input ref={input} aria-label={en?'Upload post images':'上傳文章圖片'} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event=>void upload(Array.from(event.target.files||[]))}/></div>
    {error&&<p role="alert" className="m-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    {uploading&&<p role="status" className="px-4 py-2 text-sm">{en?'Processing images…':'正在處理圖片…'}</p>}
    <EditorContent editor={editor}/>
    <p className="border-t p-3 text-xs leading-6 text-slate-500">{en?'Paste or drop images, or upload PNG/JPEG/WebP up to 5 MB (16 MP). Select an image to resize. Up to 30 images per post. Fonts use those available on the reader’s device.':'可貼上、拖曳或上傳 PNG／JPEG／WebP 圖片，每張上限 5 MB、1600 萬像素，每篇最多 30 張；點選圖片可拖曳調整大小。字型依讀者裝置可用字型呈現。'}</p>
  </div>;
}
