import {identity, fail, db} from "@/lib/server";
import {normalizeRealtimeCacheSeconds} from "@/lib/realtime-settings.mjs";
import {getPool} from "@/lib/data";
import {latestRealtimeReadings} from "@/lib/realtime-readings.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorizedDevices(store:ReturnType<typeof db>,m:any,extraIds:string[]){
 const now=new Date().toISOString();
        let deviceIds: string[] = [];
        const registeredIds = new Set<string>();
        if (m.role === "admin") {
            const devs: any = await store.prepare("SELECT id FROM devices").all();
            deviceIds = devs.results.map((d: any) => d.id);
            deviceIds.forEach(id=>registeredIds.add(id));
            deviceIds = Array.from(new Set([...deviceIds, ...extraIds]));
        } else {
            // 1. 個別設備授權 (Direct Device Grants)
            const grants: any = await store.prepare("SELECT device_id FROM grants WHERE email=? AND (grant_type='device' OR grant_type IS NULL) AND start <= ? AND (end IS NULL OR end >= ?)").bind(m.email, now, now).all();
            const grantedIds: string[] = grants.results.map((g: any) => g.device_id).filter(Boolean);

            // 2. 地點授權 (Lab Grants: 僅回傳當前在該站點有效服役的設備)
            const labGrants: any = await store.prepare("SELECT lab_id FROM grants WHERE email=? AND grant_type='lab' AND start <= ? AND (end IS NULL OR end >= ?)").bind(m.email, now, now).all();
            const labDevIds: string[] = [];
            for (const lg of labGrants.results) {
                const devs: any = await store.prepare(`
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
            const maintainerRows = (await store.prepare("SELECT name FROM maintainers WHERE LOWER(email)=LOWER(?)").bind(m.email).all()).results as any[];
            const maintainerNames = Array.from(new Set([mName, ...maintainerRows.map(r => String(r.name || "").trim())].filter(Boolean)));

            let maintainedIds: string[] = [];
            if (maintainerNames.length > 0) {
                const placeholders = maintainerNames.map(() => "?").join(",");
                const maintainedDevs: any = await store.prepare(`
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

 return {deviceIds,registeredIds};
}

export async function GET(r: Request) {
    try {
        const m = await identity(r);
        const extraParam = new URL(r.url).searchParams.get('extra_ids') || '';
        if (extraParam && m.role !== 'admin') return Response.json({error:'只有管理員可以查詢未建檔設備。'}, {status:403});
        const extraIds = Array.from(new Set(extraParam.split(',').filter(Boolean)));
        if (extraParam.length > 12000 || extraIds.length > 200 || extraIds.some(id=>!/^[A-Za-z0-9_-]{1,80}$/.test(id)))
            return Response.json({error:'未建檔設備查詢最多 200 台，請縮小搜尋範圍。'}, {status:400});

        const initial=await authorizedDevices(db(),m,extraIds);
        if(!initial.deviceIds.length)return Response.json([],{headers:{'Cache-Control':'no-store'}});
        const settings=await db().prepare('SELECT realtime_cache_secs FROM alert_settings WHERE id=1').first();
        const ttlMs=normalizeRealtimeCacheSeconds(settings?.realtime_cache_secs)*1000;
        const rows=await latestRealtimeReadings(getPool(),initial.deviceIds,{ttlMs,refresh:new URL(r.url).searchParams.get('refresh')==='1'});
        // Cached/pending measurements never cache identity or grants. Recheck after I/O.
        const current=await identity(r);
        const access=await authorizedDevices(db(),current,current.role==='admin'?extraIds:[]);
        const allowed=new Set(access.deviceIds);
        const results:any[]=[];
        for(const row of rows){
          if(!allowed.has(String(row._realtime_id??row.aslung_id)))continue;
          try{
            const time=row.time instanceof Date?row.time:new Date(row.time+'Z');
            const {time:rawTime,_realtime_id:requestedId,...values}=row;
            results.push({...values,timestamp:time.toISOString(),battery:row.battery??null,
              ...(current.role==='admin'&&!access.registeredIds.has(String(row.aslung_id))?{unregistered:true}:{})});
          }catch{/* An invalid timestamp must not discard other device readings. */}
        }
        results.sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
        return Response.json(results,{headers:{'Cache-Control':'no-store'}});
    } catch(e) {
        return fail(e);
    }
}
