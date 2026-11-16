import {publicHomepageSettings,publicHomepageContent} from '@/lib/homepage-settings.mjs';
import {getSessionUser} from '@/lib/auth';
import {getConnection} from '@/lib/store.mjs';
import {listPublicPosts} from '@/lib/posts.mjs';
import {LandingPage} from '@/components/PublicSite';
export const runtime='nodejs';export const dynamic='force-dynamic';
export const metadata={title:'平台介紹 | 環境觀測資料平台'};
export default async function About(){const settings=publicHomepageSettings(getConnection());return <LandingPage content={publicHomepageContent(getConnection())} settings={settings} posts={settings.public_posts?listPublicPosts(getConnection(),{limit:6}).rows:[]} signedIn={!!await getSessionUser()}/>;}
