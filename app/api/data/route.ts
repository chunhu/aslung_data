import {canExportData} from '@/lib/permissions.mjs';
import {fetchRangesPage} from "@/lib/download-segments.mjs";
import {identity,fail,required,instant,authorizedDataRanges,permitted,AppError} from "@/lib/server";
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
        const segmentId = url.searchParams.get("segment_id");
        if (!segmentId) await permitted(m, id, start, end);
        const ranges = await authorizedDataRanges(m, id, start, end, segmentId);
        const pageFor = (cursor: string, limit = 1000) => segmentId
          ? fetchRangesPage(ranges, cursor, limit,
              (s: string, e: string, c: string, size: number) => fetchPage(id, s, e, c, size))
          : fetchPage(id, start, end, cursor, limit);

        const calibrationMode=url.searchParams.get("calibration")||"raw";
        if(!["raw","both"].includes(calibrationMode))throw new AppError(400,"校正模式僅支援 raw 或 both。");
        let calibrationSnapshot="";
        let transform=(rows:Record<string,unknown>[])=>rows;
        if(calibrationMode==="both"){
            const {currentCalibrationRecords,ensureCalibrationSchema,calibrateRows}=await import("@/lib/calibration.mjs");
            const {getConnection}=await import("@/lib/store.mjs");
            const database=getConnection();ensureCalibrationSchema(database);
            const snapshot=url.searchParams.get("calibration_snapshot");
            let records;
            if(snapshot!==null){
                if(snapshot!=="none"&&!/^\d+(,\d+){0,99}$/.test(snapshot))throw new AppError(400,"校正版本格式不正確。");
                const ids=snapshot==="none"?[]:[...new Set(snapshot.split(",").map(Number))];
                if(ids.some(v=>!Number.isSafeInteger(v)||v<=0))throw new AppError(400,"校正版本格式不正確。");
                records=ids.length?database.prepare(`SELECT * FROM calibration_records WHERE aslung_id=? AND version_id IN (${ids.map(()=>"?").join(",")})`).all(id,...ids):[];
            }else records=currentCalibrationRecords(database,id);
            calibrationSnapshot=[...new Set(records.map((record:any)=>record.version_id))].join(",")||"none";
            transform=rows=>calibrateRows(rows,records);
        }

        // 系統管理員不受 31 天時間限制；一般會員仍維持 31 天上限以維持系統效能
        if (m.role !== "admin") {
            if (new Date(end).getTime() - new Date(start).getTime() > 31 * 24 * 3600 * 1000) {
                throw new AppError(400, "為維持系統效能，一般會員查詢與下載的時間區間不可超過 31 天。請縮短日期範圍。");
            }
        }
        
        const format = url.searchParams.get("format") || "json";
        const isDownload = url.searchParams.get("download") === "1";
        
        if (isDownload && !canExportData(m)) throw new AppError(403,"檢視會員僅可查詢資料，沒有下載或批次匯出權限。");
        if (isDownload) {
            let data: Record<string,unknown>[] = [];
            let currentCursor = "";
            const pageSize = 5000;
            let safetyLimit = m.role === "admin" ? 50000 : 2000;
            while (safetyLimit > 0) {
                const res = await pageFor(currentCursor, pageSize);
                data = data.concat(transform(res.data as Record<string,unknown>[]));
                if (!res.has_more) break;
                currentCursor = res.next_cursor as string;
                safetyLimit--;
                if (!safetyLimit) throw new AppError(413, "資料量超過單次匯出上限，請縮短期間後重試。");
            }
            if (format === "csv") {
                return new Response(toCsv(data), {
                    headers: {
                        "Content-Type": "text/csv; charset=utf-8",
                        "Content-Disposition": `attachment; filename="aslung_${id}_export.csv"`
                    }
                });
            } else {
                return new Response(JSON.stringify({aslung_id: id, segment_id: segmentId, start, end, authorized_ranges: ranges,calibration:calibrationMode,calibration_snapshot:calibrationSnapshot, data}), {
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Content-Disposition": `attachment; filename="aslung_${id}_export.json"`
                    }
                });
            }
        }
        
        const cursor = url.searchParams.get("cursor") || "";
        const page = await pageFor(cursor);
        return Response.json({aslung_id:id,start,end,segment_id:segmentId,authorized_ranges:ranges,...page,data:transform(page.data),calibration:calibrationMode,calibration_snapshot:calibrationSnapshot}, {headers: {"Cache-Control": "no-store"}});
    } catch(e) {
        return fail(e);
    }
}
