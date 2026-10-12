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
    redirect("/login");
  }
  return <Workspace signedIn={true} signInUrl="/login"/>;
}
