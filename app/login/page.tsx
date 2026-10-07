import LoginForm from "./form";
import {getSessionUser} from "@/lib/auth";
import {redirect} from "next/navigation";
export const runtime="nodejs";export const dynamic="force-dynamic";
export default async function Login(){if(await getSessionUser())redirect("/");return <LoginForm/>;}
