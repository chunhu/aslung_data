import {getSessionUser} from "@/lib/auth";
import Workspace from "./workspace";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function Home(){const user=await getSessionUser();return <Workspace signedIn={!!user} signInUrl="/login"/>;}
