// Shared allowlisted document schema. Readers render React nodes, never arbitrary HTML.
export class PostDocumentError extends Error{constructor(message){super(message);this.status=400;}}
const bad=message=>{throw new PostDocumentError(message);};
export const POST_FONTS=['sans-serif','serif','monospace','Arial','Georgia','Times New Roman','Microsoft JhengHei','PMingLiU','Noto Sans TC'];
export const POST_SIZES=['12px','14px','16px','18px','20px','24px','28px','32px'];
const blocks=['paragraph','heading','bulletList','orderedList','blockquote','codeBlock','horizontalRule','image','table'];
const children={doc:blocks,paragraph:['text','hardBreak'],heading:['text','hardBreak'],bulletList:['listItem'],orderedList:['listItem'],listItem:blocks,blockquote:blocks,codeBlock:['text'],table:['tableRow'],tableRow:['tableCell','tableHeader'],tableCell:blocks,tableHeader:blocks};
export function safePostLink(value){if(typeof value==='string'&&/^\/file-catalog(?:\?lang=(?:en|zh-TW))?$/.test(value))return value;if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f]/.test(value))bad('連結須為有效的 HTTP(S) 網址。');let url;try{url=new URL(value);}catch{bad('連結須為完整 HTTP(S) 網址。');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)bad('連結僅接受無帳密的 HTTP(S) 網址。');return url.href;}
export function postImageId(src){if(typeof src!=='string')bad('圖片來源不正確。');const match=/^\/api\/posts\/images\?id=([a-f0-9-]{36})$/.exec(src);if(!match)bad('文章只能使用網站上傳的圖片，請先上傳圖片。');return match[1];}
function color(value){if(typeof value!=='string'||!/^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(value)&&!/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(value))bad('文字顏色格式不正確。');return value;}
const dimension=(value,min,max)=>{const n=typeof value==='string'&&/^\d+(?:px)?$/.test(value)?parseInt(value):value;if(!Number.isSafeInteger(n)||n<min||n>max)bad('尺寸或表格設定超過允許範圍。');return n;};
export function normalizePostDocument(input){
  if(typeof input==='string'){if(input.length>1000000)bad('文章格式內容過大。');try{input=JSON.parse(input);}catch{bad('文章格式不正確。');}}
  let count=0,textLength=0;const images=new Set();
  function walk(node,depth=0){
    if(!node||typeof node!=='object'||Array.isArray(node)||++count>5000||depth>20)bad('文章結構過於複雜。');
    const type=node.type;if(![...blocks,'doc','text','hardBreak','listItem','tableRow','tableCell','tableHeader'].includes(type))bad('文章包含不支援的內容。');
    const clean={type},attrs={},a=node.attrs||{};
    if(type==='text'){if(typeof node.text!=='string'||!node.text.length)bad('文字內容不正確。');textLength+=node.text.length;if(textLength>60000)bad('內文最多 60,000 字。');clean.text=node.text;}
    if(type==='heading')attrs.level=dimension(a.level,1,4);
    if(['paragraph','heading'].includes(type)&&a.textAlign!=null){if(!['left','center','right','justify'].includes(a.textAlign))bad('對齊方式不正確。');attrs.textAlign=a.textAlign;}
    if(type==='orderedList'&&a.start!=null)attrs.start=dimension(a.start,1,10000);
    if(type==='image'){
      const id=postImageId(a.src);images.add(id);if(images.size>30)bad('每篇文章最多 30 張不同圖片。');attrs.src='/api/posts/images?id='+id;
      for(const key of ['alt','title'])if(a[key]!=null){if(typeof a[key]!=='string'||a[key].length>500)bad('圖片說明最多 500 字。');attrs[key]=a[key];}
      for(const key of ['width','height'])if(a[key]!=null)attrs[key]=dimension(typeof a[key]==='number'?Math.round(a[key]):a[key],1,2400);
    }
    if(['tableCell','tableHeader'].includes(type)){
      for(const key of ['colspan','rowspan'])if(a[key]!=null)attrs[key]=dimension(a[key],1,20);
      if(a.colwidth!=null){if(!Array.isArray(a.colwidth)||a.colwidth.length>20)bad('表格欄寬不正確。');attrs.colwidth=a.colwidth.map(value=>dimension(value,1,2400));}
    }
    if(Object.keys(attrs).length)clean.attrs=attrs;
    if(node.marks!=null){
      if(type!=='text'||!Array.isArray(node.marks)||node.marks.length>10)bad('文字格式不正確。');
      clean.marks=node.marks.map(mark=>{
        if(!mark||!['bold','italic','underline','strike','code','subscript','superscript','link','textStyle'].includes(mark.type))bad('不支援的文字格式。');
        const m={type:mark.type};
        if(mark.type==='link')m.attrs={href:safePostLink(mark.attrs?.href),target:'_blank',rel:'noopener noreferrer'};
        if(mark.type==='textStyle'){const style={};for(const key of ['color','backgroundColor'])if(mark.attrs?.[key])style[key]=color(mark.attrs[key]);
          if(mark.attrs?.fontFamily){if(!POST_FONTS.includes(mark.attrs.fontFamily))bad('請使用編輯器提供的字型。');style.fontFamily=mark.attrs.fontFamily;}
          if(mark.attrs?.fontSize){if(!POST_SIZES.includes(mark.attrs.fontSize))bad('請使用編輯器提供的字級。');style.fontSize=mark.attrs.fontSize;}
          m.attrs=style;
        }return m;
      });
    }
    if(node.content!=null){if(!children[type]||!Array.isArray(node.content))bad('文章子節點不正確。');clean.content=node.content.map(child=>{if(!children[type].includes(child?.type))bad('段落、清單或表格結構不正確。');return walk(child,depth+1);});}
    if(['bulletList','orderedList','listItem','table','tableRow','tableCell','tableHeader','blockquote'].includes(type)&&!clean.content?.length)bad('清單或表格不可為空。');
    if(type==='table'&&(clean.content.length>100||clean.content.some(row=>row.content.length>20)))bad('表格最多 100 列、20 欄。');
    return clean;
  }
  if(input?.type!=='doc')bad('文章根節點不正確。');const doc=walk(input);
  function plain(node){if(node.type==='text')return node.text;if(node.type==='hardBreak')return '\n';if(node.type==='image')return node.attrs.alt||'[圖片]';return (node.content||[]).map(plain).join(['paragraph','heading','codeBlock'].includes(node.type)?'':'\n');}
  const text=plain(doc).trim();if(!text||text.length>60000)bad('內文請填寫完整，最多 60,000 字。');
  const json=JSON.stringify(doc);if(json.length>1000000)bad('文章格式內容過大。');return {doc,text,json,images:[...images]};
}
export function plainPostDocument(body=''){return {type:'doc',content:String(body).split(/\n\s*\n/).map(paragraph=>({type:'paragraph',...(paragraph?{content:paragraph.split('\n').flatMap((text,index)=>[...(index?[{type:'hardBreak'}]:[]),...(text?[{type:'text',text}]:[])])}:{})}))};}

export function fileCatalogueDocument(english=false){return {type:'paragraph',content:[{type:'text',text:english?'Go to downloads / request access':'前往下載／申請區',marks:[{type:'link',attrs:{href:english?'/file-catalog?lang=en':'/file-catalog?lang=zh-TW'}}]}]};}
