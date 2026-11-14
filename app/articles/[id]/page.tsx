import {notFound} from 'next/navigation';
import {getConnection} from '@/lib/store.mjs';
import {getPublicPost,PostError} from '@/lib/posts.mjs';
import {getSessionUser} from '@/lib/auth';
import {PublicArticle} from '@/components/PublicSite';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function load(id:string){try{return getPublicPost(getConnection(),id);}catch(e){if(e instanceof PostError)notFound();throw e;}}
export async function generateMetadata({params}:{params:Promise<{id:string}>}){const post=await load((await params).id);return {title:post.title+' | 環境觀測資料平台',description:post.summary};}
export default async function Article({params}:{params:Promise<{id:string}>}){const post=await load((await params).id);return <PublicArticle post={post} signedIn={!!await getSessionUser()}/>;}
