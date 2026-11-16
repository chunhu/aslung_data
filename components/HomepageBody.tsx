import RichPostBody from '@/components/RichPostBody';
import {normalizeHomepageRich} from '@/lib/homepage-content.mjs';
export default function HomepageBody({body,document,className=''}:{body:string;document?:string;className?:string}){
 let rich:string|null=null;try{if(document)rich=normalizeHomepageRich(document).json;}catch{/* Invalid drafts keep a safe plain-text preview. */}
 return <div className={'homepage-rich-body '+className}>{rich?<RichPostBody document={rich}/>:<p className="whitespace-pre-line">{body}</p>}</div>;
}
