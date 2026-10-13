import LoginForm from "./form";
import {getSessionUser} from "@/lib/auth";
import {recordSiteVisit} from "@/lib/server";
import {headers} from "next/headers";
import {redirect} from "next/navigation";
export const runtime="nodejs";export const dynamic="force-dynamic";
export default async function Login({ searchParams }: { searchParams?: Promise<{ id?: string }> }){
  const sp = searchParams ? await searchParams : {};
  if(await getSessionUser()) {
    if (sp?.id) redirect(`/?id=${encodeURIComponent(sp.id)}`);
    redirect("/");
  }
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "";
    const ua = h.get("user-agent") || "";
    recordSiteVisit({ path: "/login", ip, userAgent: ua });
  } catch {}
  return <LoginForm/>;
}
