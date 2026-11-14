import {notFound} from 'next/navigation';
import {getConnection} from '@/lib/store.mjs';
import {listPublicPosts,PostError} from '@/lib/posts.mjs';
import {getSessionUser} from '@/lib/auth';
import {PublicArticleListing} from '@/components/PublicSite';
export const runtime='nodejs';export const dynamic='force-dynamic';
export const metadata={title:'公開文章 | 環境觀測資料平台'};
export default async function Articles({searchParams}:{searchParams:Promise<{q?:string;page?:string}>}){
  const params=await searchParams,q=params.q||'';let feed;
  try{feed=listPublicPosts(getConnection(),{q,page:Number(params.page||1)});}catch(e){if(e instanceof PostError)notFound();throw e;}
  return <PublicArticleListing feed={feed} q={q} signedIn={!!await getSessionUser()}/>;
}
