import {identity,fail,required,instant,permitted,AppError} from "@/lib/server";
import {fetchPage,toCsv} from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(r: Request) {
    try {
        const url = new URL(r.url);
        const id = required(url.searchParams.get("aslung_id"), 80);
        const start = instant(url.searchParams.get("start"));
        const end = instant(url.searchParams.get("end"));
        if (start > end) throw new AppError(400, "開始時間不能晚於結束時間。");
        const m = await identity(r);
        await permitted(m, id, start, end);

        // 系統管理員不受 31 天時間限制；一般會員仍維持 31 天上限以維持系統效能
        if (m.role !== "admin") {
            if (new Date(end).getTime() - new Date(start).getTime() > 31 * 24 * 3600 * 1000) {
                throw new AppError(400, "為維持系統效能，一般會員查詢與下載的時間區間不可超過 31 天。請縮短日期範圍。");
            }
        }
        
        const format = url.searchParams.get("format") || "json";
        const isDownload = url.searchParams.get("download") === "1";
        
        if (isDownload) {
            let data: Record<string,unknown>[] = [];
            let currentCursor = "";
            const pageSize = 5000;
            let safetyLimit = m.role === "admin" ? 50000 : 2000;
            while (safetyLimit > 0) {
                const res = await fetchPage(id, start, end, currentCursor, pageSize);
                data = data.concat(res.data as Record<string,unknown>[]);
                if (!res.has_more) break;
                currentCursor = res.next_cursor as string;
                safetyLimit--;
            }
            if (format === "csv") {
                return new Response(toCsv(data), {
                    headers: {
                        "Content-Type": "text/csv; charset=utf-8",
                        "Content-Disposition": `attachment; filename="aslung_${id}_export.csv"`
                    }
                });
            } else {
                return new Response(JSON.stringify({aslung_id: id, start, end, data}), {
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Content-Disposition": `attachment; filename="aslung_${id}_export.json"`
                    }
                });
            }
        }
        
        const cursor = url.searchParams.get("cursor") || "";
        const page = await fetchPage(id, start, end, cursor);
        return Response.json(page, {headers: {"Cache-Control": "no-store"}});
    } catch(e) {
        return fail(e);
    }
}
