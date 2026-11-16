import {publicHomepageSettings,publicHomepageContent} from '@/lib/homepage-settings.mjs';
import {LandingPage} from '@/components/PublicSite';
import {getConnection} from '@/lib/store.mjs';
import {listPublicPosts} from '@/lib/posts.mjs';
import {getSessionUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import Workspace from "./workspace";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function Home({ searchParams }: { searchParams?: Promise<{ id?: string }> }){
  const user=await getSessionUser();
  const sp = searchParams ? await searchParams : {};
  if(!user) {
    if (sp?.id) redirect(`/login?id=${encodeURIComponent(sp.id)}`);
    const settings=publicHomepageSettings(getConnection());
    return <LandingPage content={publicHomepageContent(getConnection())} settings={settings} posts={settings.public_posts?listPublicPosts(getConnection(),{limit:6}).rows:[]}/>;
  }

  return <Workspace signedIn={true} signInUrl="/login"/>;
}
