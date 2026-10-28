export const ADMIN_REALTIME_INTERVALS = [60, 120, 300, 600, 900, 1200, 1800];
export const MEMBER_REALTIME_INTERVALS = [300, 600, 900, 1200, 1800];

export function normalizeRealtimeInterval(value, isAdmin) {
  const options = isAdmin ? ADMIN_REALTIME_INTERVALS : MEMBER_REALTIME_INTERVALS;
  if (value === null || value === "") return options[0];
  const seconds = Number(value);
  if (seconds === 0) return 0;
  if (!Number.isFinite(seconds) || seconds < 0) return options[0];
  return options.find(option => option >= seconds) ?? options[options.length - 1];
}

export const DEFAULT_REALTIME_CACHE_SECONDS = 120;
export const MAX_REALTIME_CACHE_SECONDS = 3600;
export function validRealtimeCacheSeconds(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_REALTIME_CACHE_SECONDS;
}
export function normalizeRealtimeCacheSeconds(value) {
  return validRealtimeCacheSeconds(value) ? value : DEFAULT_REALTIME_CACHE_SECONDS;
}
