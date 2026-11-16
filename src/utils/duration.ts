/**
 * Duration and clock formatting for reset countdowns, shared by the report
 * and the footer meter.
 */

const MINUTE_MS = 60 * 1000;
const DAY_MINUTES = 24 * 60;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Format a duration compactly.
 * - `'full'`:  `2d 8h`, `3h 33m`, `45m`
 * - `'short'`: `2d`,    `3h 33m`, `45m` (days only once a day or more is left)
 * Negative durations count as zero.
 */
export function formatDuration(ms: number, style: 'full' | 'short' = 'full'): string {
  const totalMinutes = Math.max(0, Math.floor(ms / MINUTE_MS));
  if (totalMinutes >= DAY_MINUTES) {
    const days = Math.floor(totalMinutes / DAY_MINUTES);
    if (style === 'short') return `${days}d`;
    return `${days}d ${Math.floor((totalMinutes % DAY_MINUTES) / 60)}h`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Local clock time of a timestamp: `23:29`, or `Thu 17:02` with the weekday.
 */
export function formatClock(timestamp: number, withWeekday: boolean): string {
  const date = new Date(timestamp);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return withWeekday ? `${DAY_NAMES[date.getDay()]} ${time}` : time;
}

/**
 * Milliseconds until a timestamp, or null when it is missing or already past.
 */
export function timeUntil(timestamp: number | null | undefined, now: number = Date.now()): number | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  const left = timestamp - now;
  return left > 0 ? left : null;
}
