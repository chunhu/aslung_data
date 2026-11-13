import {createElement,Fragment,type ReactNode} from 'react';
import {normalizePostDocument} from '@/lib/post-document.mjs';
export default function RichPostBody({document}:{document:string|object}){
  let doc:any;try{doc=normalizePostDocument(document).doc;}catch{return <p role="alert">文章格式無法顯示。</p>;}
  function render(node:any,index:number):ReactNode{
    if(node.type==='text')return (node.marks||[]).reduce((text:ReactNode,mark:any,i:number)=>{
      const key=index+'_'+i;if(mark.type==='link')return <a key={key} href={mark.attrs.href} target="_blank" rel="noopener noreferrer">{text}</a>;
      if(mark.type==='textStyle')return <span key={key} style={mark.attrs}>{text}</span>;
      return createElement(({bold:'strong',italic:'em',underline:'u',strike:'s',code:'code',subscript:'sub',superscript:'sup'} as any)[mark.type],{key},text);
    },node.text);
    if(node.type==='hardBreak')return <br key={index}/>;
    if(node.type==='horizontalRule')return <hr key={index}/>;
    if(node.type==='image')return <img key={index} src={node.attrs.src} alt={node.attrs.alt||''} title={node.attrs.title||undefined} width={node.attrs.width||undefined} height={node.attrs.height||undefined} loading="lazy" decoding="async"/>;
    const content=(node.content||[]).map(render);
    if(node.type==='doc')return <Fragment key={index}>{content}</Fragment>;
    if(node.type==='codeBlock')return <pre key={index}><code>{content}</code></pre>;
    const tag=node.type==='heading'?'h'+node.attrs.level:({paragraph:'p',bulletList:'ul',orderedList:'ol',listItem:'li',blockquote:'blockquote',table:'table',tableRow:'tr',tableCell:'td',tableHeader:'th'} as any)[node.type];
    const props:any={key:index};if(node.attrs?.textAlign)props.style={textAlign:node.attrs.textAlign};if(node.type==='orderedList')props.start=node.attrs?.start;
    if(['tableCell','tableHeader'].includes(node.type)){props.colSpan=node.attrs?.colspan;props.rowSpan=node.attrs?.rowspan;}
    const element=createElement(tag,props,node.type==='table'?<tbody>{content}</tbody>:content);
    return node.type==='table'?<div key={index} className="overflow-x-auto">{element}</div>:element;
  }
  return <div className="post-rich-content">{render(doc,0)}</div>;
}
