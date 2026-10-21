import {identity, fail, db} from "@/lib/server";
import {getPool} from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(r: Request) {
    try {
        const m = await identity(r);
        const now = new Date().toISOString();
        const extraParam = new URL(r.url).searchParams.get('extra_ids') || '';
        if (extraParam && m.role !== 'admin') return Response.json({error:'只有管理員可以查詢未建檔設備。'}, {status:403});
        const extraIds = Array.from(new Set(extraParam.split(',').filter(Boolean)));
        if (extraParam.length > 12000 || extraIds.length > 200 || extraIds.some(id=>!/^[A-Za-z0-9_-]{1,80}$/.test(id)))
            return Response.json({error:'未建檔設備查詢最多 200 台，請縮小搜尋範圍。'}, {status:400});

        let deviceIds: string[] = [];
        const registeredIds = new Set<string>();
        if (m.role === "admin") {
            const devs: any = await db().prepare("SELECT id FROM devices").all();
            deviceIds = devs.results.map((d: any) => d.id);
            deviceIds.forEach(id=>registeredIds.add(id));
            deviceIds = Array.from(new Set([...deviceIds, ...extraIds]));
        } else {
            // 1. 個別設備授權 (Direct Device Grants)
            const grants: any = await db().prepare("SELECT device_id FROM grants WHERE email=? AND (grant_type='device' OR grant_type IS NULL) AND start <= ? AND (end IS NULL OR end >= ?)").bind(m.email, now, now).all();
            const grantedIds: string[] = grants.results.map((g: any) => g.device_id).filter(Boolean);

            // 2. 地點授權 (Lab Grants: 僅回傳當前在該站點有效服役的設備)
            const labGrants: any = await db().prepare("SELECT lab_id FROM grants WHERE email=? AND grant_type='lab' AND start <= ? AND (end IS NULL OR end >= ?)").bind(m.email, now, now).all();
            const labDevIds: string[] = [];
            for (const lg of labGrants.results) {
                const devs: any = await db().prepare(`
                    SELECT DISTINCT dl.aslung_id AS id
                    FROM device_locations dl
                    WHERE dl.lab_id = ?
                      AND dl.start_time <= ?
                      AND (dl.end_time IS NULL OR dl.end_time = '' OR dl.end_time >= ?)
                      AND dl.active = 1
                    UNION
                    SELECT d.id
                    FROM devices d
                    WHERE d.location = ?
                      AND (d.status = 'DEPLOYED' OR d.status = '' OR d.status IS NULL)
                      AND NOT EXISTS (SELECT 1 FROM device_locations dl WHERE dl.aslung_id = d.id)
                `).bind(lg.lab_id, now, now, lg.lab_id).all();
                for (const d of devs.results) {
                    if (d.id) labDevIds.push(d.id);
                }
            }

            // 3. 維護人員列管設備 (僅回傳當前負責維護且服役中的設備)
            const mName = m.allowMaintainerNameMatch ? String(m.name || "").trim() : "";
            const maintainerRows = (await db().prepare("SELECT name FROM maintainers WHERE LOWER(email)=LOWER(?)").bind(m.email).all()).results as any[];
            const maintainerNames = Array.from(new Set([mName, ...maintainerRows.map(r => String(r.name || "").trim())].filter(Boolean)));

            let maintainedIds: string[] = [];
            if (maintainerNames.length > 0) {
                const placeholders = maintainerNames.map(() => "?").join(",");
                const maintainedDevs: any = await db().prepare(`
                    SELECT DISTINCT aslung_id FROM device_locations
                    WHERE TRIM(maintainer) IN (${placeholders})
                      AND start_time <= ?
                      AND (end_time IS NULL OR end_time = '' OR end_time >= ?)
                      AND active = 1
                `).bind(...maintainerNames, now, now).all();
                maintainedIds = maintainedDevs.results.map((r: any) => r.aslung_id).filter(Boolean);
            }

            deviceIds = Array.from(new Set([...grantedIds, ...labDevIds, ...maintainedIds]));
        }

        const pool = getPool();
        const results: any[] = [];
        const sql = `
            SELECT time, uid AS aslung_id, ch1 AS PM1_G3, ch2 AS \`PM2.5_G3\`, ch3 AS PM10_G3,
                   ch4 AS temperature, ch5 AS rh, ch6 AS co2, ch7 AS battery,
                   ch29 AS PM1_GSA, ch30 AS \`PM2.5_GSA\`, ch31 AS PM10_GSA
            FROM rawdata WHERE uid = ? ORDER BY time DESC LIMIT 1
        `;

        const BATCH_SIZE = 8;
        for (let i = 0; i < deviceIds.length; i += BATCH_SIZE) {
            const batch = deviceIds.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async (id) => {
                try {
                    const [rows]: any = await pool.query(sql, [id]);
                    if (rows.length > 0) {
                        const r = rows[0];
                        const t = r.time instanceof Date ? r.time : new Date(r.time + 'Z');
                        return {
                            timestamp: t.toISOString(),
                            aslung_id: r.aslung_id,
                            ...(m.role === 'admin' && !registeredIds.has(r.aslung_id) ? {unregistered:true} : {}),
                            PM1_G3: r.PM1_G3,
                            'PM2.5_G3': r['PM2.5_G3'],
                            PM10_G3: r.PM10_G3,
                            temperature: r.temperature,
                            rh: r.rh,
                            co2: r.co2,
                            battery: r.battery ?? null,
                            PM1_GSA: r.PM1_GSA,
                            'PM2.5_GSA': r['PM2.5_GSA'],
                            PM10_GSA: r.PM10_GSA,
                        };
                    }
                } catch (e) {
                    console.error("Failed to fetch realtime for", id, e);
                }
                return null;
            }));
            for (const item of batchResults) {
                if (item) results.push(item);
            }
        }

        results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return Response.json(results, {headers: {"Cache-Control": "no-store"}});
    } catch(e) {
        return fail(e);
    }
}
