import {getSessionUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import Workspace from "./workspace";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function Home(){
  const user=await getSessionUser();
  if(!user) redirect("/login");
  return <Workspace signedIn={true} signInUrl="/login"/>;
}
