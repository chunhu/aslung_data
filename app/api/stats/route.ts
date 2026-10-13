import {getSiteStats} from "@/lib/server";
export const dynamic="force-dynamic";
export const runtime="nodejs";

export async function GET() {
  return Response.json(getSiteStats(), {
    headers: {"Cache-Control": "no-store"}
  });
}
