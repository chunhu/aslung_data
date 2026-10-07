import { AppError } from "./server";
import mysql from "mysql2/promise";

let pool: mysql.Pool;
export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || '35.160.61.178',
      user: process.env.MYSQL_USER || 'seldata',
      password: process.env.MYSQL_PASSWORD || 'datasel',
      database: process.env.MYSQL_DATABASE || 'rcec_lung',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: '+00:00', // UTC
      decimalNumbers: true,
    });
  }
  return pool;
}

export async function fetchPage(id: string, start: string, end: string, cursor: string) {
  const p = getPool();
  
  const startTime = new Date(start).toISOString().slice(0, 19).replace('T', ' ');
  const endTime = new Date(end).toISOString().slice(0, 19).replace('T', ' ');

  let cursorTime = "";
  let cursorId = 0;
  if (cursor) {
    try {
      const c = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
      cursorTime = c.time;
      cursorId = c.id;
    } catch {
      // invalid cursor
    }
  }

  let sql = `
    SELECT
      id,
      uid AS aslung_id,
      time,
      ch1 AS PM1_G3, ch2 AS \`PM2.5_G3\`, ch3 AS PM10_G3,
      ch4 AS temperature, ch5 AS rh, ch6 AS co2, ch7 AS battery,
      ch8 AS acc_x, ch9 AS acc_y, ch10 AS acc_z,
      ch11 AS gps, ch12 AS gps_speed, ch13 AS gps_direction, ch14 AS gps_height,
      ch21 AS air_pressure, ch22 AS noise1, ch23 AS noise2, ch24 AS noise3,
      ch29 AS PM1_GSA, ch30 AS \`PM2.5_GSA\`, ch31 AS PM10_GSA,
      ch32 AS \`Num_0.3_GSA\`, ch33 AS \`Num_0.5_GSA\`, ch34 AS \`Num_1.0_GSA\`,
      ch35 AS \`Num_2.5_GSA\`, ch36 AS \`Num_5.0_GSA\`, ch37 AS \`Num_10_GSA\`
    FROM rawdata
    WHERE uid = ?
      AND time >= ?
      AND time <= ?
  `;
  const params: any[] = [id, startTime, endTime];

  if (cursorTime && cursorId) {
    sql += ` AND (time > ? OR (time = ? AND id > ?))`;
    params.push(cursorTime, cursorTime, cursorId);
  }

  sql += ` ORDER BY time ASC, id ASC LIMIT 1000`;

  let rows: any[];
  try {
    [rows] = await p.query(sql, params) as [any[], any];
  } catch (err: any) {
    console.error("MySQL Error:", err);
    throw new AppError(502, "無法連線至 EC2 MySQL 資料庫或查詢失敗。");
  }

  const data = rows.map(r => {
    const t = r.time instanceof Date ? r.time : new Date(r.time + 'Z');
    const { time, ...rest } = r;
    return {
      timestamp: t.toISOString(),
      ...rest,
    };
  });

  const has_more = data.length === 1000;
  let next_cursor = null;
  if (has_more) {
    const last = rows[rows.length - 1];
    const lastTimeStr = last.time instanceof Date ? last.time.toISOString().slice(0, 19).replace('T', ' ') : last.time;
    next_cursor = Buffer.from(JSON.stringify({ time: lastTimeStr, id: last.id })).toString('base64');
  }

  return {
    aslung_id: id,
    start,
    end,
    data,
    has_more,
    next_cursor
  };
}

export function csvCell(value: unknown) {
  let s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return s;
}

export function toCsv(rows: Record<string, unknown>[]) {
  const keys = Array.from(new Set(["timestamp", ...rows.flatMap(r => Object.keys(r))]));
  return "\uFEFF" + [
    keys.map(csvCell).join(","),
    ...rows.map(r => keys.map(k => csvCell(r[k])).join(","))
  ].join("\r\n");
}
