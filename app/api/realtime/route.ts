import {identity, fail, db} from "@/lib/server";
import {getPool} from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(r: Request) {
    try {
        const m = await identity(r);
        const now = new Date().toISOString();

        let deviceIds: string[] = [];
        if (m.role === "admin") {
            const devs: any = await db().prepare("SELECT id FROM devices").all();
            deviceIds = devs.results.map((d: any) => d.id);
        } else {
            const grants: any = await db().prepare("SELECT device_id FROM grants WHERE email=? AND start <= ? AND (end IS NULL OR end >= ?)").bind(m.email, now, now).all();
            deviceIds = Array.from(new Set(grants.results.map((g: any) => g.device_id)));
        }

        const pool = getPool();
        const results = [];

        for (const id of deviceIds) {
            const sql = `
                SELECT time, uid AS aslung_id, ch1 AS PM1_G3, ch2 AS \`PM2.5_G3\`, ch3 AS PM10_G3,
                       ch4 AS temperature, ch5 AS rh, ch6 AS co2,
                       ch29 AS PM1_GSA, ch30 AS \`PM2.5_GSA\`, ch31 AS PM10_GSA
                FROM rawdata WHERE uid = ? ORDER BY time DESC LIMIT 1
            `;
            try {
                const [rows]: any = await pool.query(sql, [id]);
                if (rows.length > 0) {
                    const r = rows[0];
                    const t = r.time instanceof Date ? r.time : new Date(r.time + 'Z');
                    results.push({
                        timestamp: t.toISOString(),
                        aslung_id: r.aslung_id,
                        PM1_G3: r.PM1_G3,
                        'PM2.5_G3': r['PM2.5_G3'],
                        PM10_G3: r.PM10_G3,
                        temperature: r.temperature,
                        rh: r.rh,
                        co2: r.co2,
                        PM1_GSA: r.PM1_GSA,
                        'PM2.5_GSA': r['PM2.5_GSA'],
                        PM10_GSA: r.PM10_GSA,
                    });
                }
            } catch (e) {
                console.error("Failed to fetch realtime for", id, e);
            }
        }

        results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return Response.json(results, {headers: {"Cache-Control": "no-store"}});
    } catch(e) {
        return fail(e);
    }
}
