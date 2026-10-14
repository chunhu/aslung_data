// All permission comparisons use instants. SQLite deployment dates without a
// timezone are entered in Taiwan local time, just like the management form.
export function rangeTime(value, fallback) {
  if (!value) return fallback;
  const text = String(value).trim().replace(' ', 'T');
  return Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(text) ? text : text + '+08:00');
}

export function mergeRanges(ranges) {
  const ordered = ranges.map(r => ({start: rangeTime(r.start, -Infinity), end: rangeTime(r.end, Infinity)}))
    .filter(r => !Number.isNaN(r.start) && !Number.isNaN(r.end) && r.start <= r.end)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of ordered) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({...range});
  }
  return merged.map(r => ({start: Number.isFinite(r.start) ? new Date(r.start).toISOString() : null,
    end: Number.isFinite(r.end) ? new Date(r.end).toISOString() : null}));
}

export function intersectRanges(ranges, start, end) {
  const lower = rangeTime(start, -Infinity), upper = rangeTime(end, Infinity);
  return mergeRanges(ranges.map(r => {
    const s = Math.max(lower, rangeTime(r.start, -Infinity));
    const e = Math.min(upper, rangeTime(r.end, Infinity));
    return s <= e ? {start: Number.isFinite(s) ? new Date(s).toISOString() : null,
      end: Number.isFinite(e) ? new Date(e).toISOString() : null} : null;
  }).filter(Boolean));
}

export function buildDownloadSegments(member, devices, locations, grants, maintainers = []) {
  const names = new Set([member.allowMaintainerNameMatch === false ? '' : String(member.name || '').trim(), ...maintainers
    .filter(m => m.email && m.email.toLowerCase() === member.email.toLowerCase())
    .map(m => String(m.name || '').trim())].filter(Boolean));
  const deviceMap = new Map(devices.map(d => [d.id, d]));
  return locations.flatMap(location => {
    const device = deviceMap.get(location.aslung_id);
    if (!device) return [];
    let ranges = [];
    if (member.role === 'admin' || names.has(String(location.maintainer || '').trim())) {
      ranges = [{start: location.start_time, end: location.end_time}];
    } else {
      ranges = grants.filter(g => g.email.toLowerCase() === member.email.toLowerCase() &&
        (g.grant_type === 'lab' ? g.lab_id === location.lab_id : g.device_id === device.id))
        .flatMap(g => intersectRanges([{start: g.start, end: g.end}], location.start_time, location.end_time));
    }
    ranges = mergeRanges(ranges);
    if (!ranges.length && member.role !== "admin") return [];
    return [{...device, selection_id: String(location.id), segment_id: String(location.id),
      grant_lab_id: location.lab_id, location: location.lab_id,
      invalid_range: !ranges.length,
      start: ranges[0]?.start || location.start_time, end: ranges.at(-1)?.end || location.end_time,
      deployment_start: location.start_time, deployment_end: location.end_time,
      tracking_ranges: ranges.map(r => ({...r, active: !!location.active && !location.end_time})),
      is_active_at_lab: !!location.active && !location.end_time}];
  }).sort((a, b) => {
    const labA = a.grant_lab_id || '', labB = b.grant_lab_id || '';
    if (labA !== labB) return !labA ? 1 : !labB ? -1 : labA.localeCompare(labB, 'en', {numeric: true});
    return rangeTime(b.deployment_start, -Infinity) - rangeTime(a.deployment_start, -Infinity)
      || a.id.localeCompare(b.id, 'en', {numeric: true}) || Number(a.segment_id) - Number(b.segment_id);
  });
}

// The cursor contains a range index and the underlying measurement cursor.
// Each page walks every authorized interval without querying the gaps.
export async function fetchRangesPage(ranges, cursor, limit, fetcher) {
  let index = 0, inner = '';
  if (cursor) {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Number.isInteger(parsed.range) || parsed.range < 0 || parsed.range >= ranges.length || typeof parsed.cursor !== 'string')
      throw new Error('Invalid range cursor');
    index = parsed.range;
    inner = parsed.cursor;
  }
  const data = [];
  while (index < ranges.length && data.length < limit) {
    const range = ranges[index];
    const page = await fetcher(range.start, range.end, inner, limit - data.length);
    data.push(...page.data);
    if (page.has_more) {
      if (!page.next_cursor || page.next_cursor === inner) throw new Error('Measurement cursor did not advance');
      inner = page.next_cursor;
    } else { index++; inner = ''; }
  }
  const has_more = index < ranges.length;
  return {data, has_more, next_cursor: has_more ? Buffer.from(JSON.stringify({range:index,cursor:inner})).toString('base64url') : null};
}
