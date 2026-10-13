import {getSessionUser} from "@/lib/auth";
import {recordSiteVisit} from "@/lib/server";
import {headers} from "next/headers";
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
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
    const ua = h.get("user-agent") || "";
    recordSiteVisit({ path: "/", email: user.email, ip, userAgent: ua });
  } catch {}
  return <Workspace signedIn={true} signInUrl="/login"/>;
}
