import LoginForm from "./form";
import {getSessionUser} from "@/lib/auth";
import {redirect} from "next/navigation";
export const runtime="nodejs";export const dynamic="force-dynamic";
export default async function Login({ searchParams }: { searchParams?: Promise<{ id?: string }> }){
  const sp = searchParams ? await searchParams : {};
  if(await getSessionUser()) {
    if (sp?.id) redirect(`/?id=${encodeURIComponent(sp.id)}`);
    redirect("/");
  }
  return <LoginForm/>;
}
