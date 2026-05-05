// QuietKeep: utils/formatDate.ts
// Date formatting utilities for API timestamps and derived durations.
// Author: QuietWire (Dennis Ayotte)

/**
 * Parse a UTC timestamp from the API (which may lack a Z suffix)
 * and return a locale-formatted string in the user's timezone.
 */
export function formatUTC(dateStr: string): string {
  const s = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
  return new Date(s).toLocaleString();
}

/**
 * Format a host's last-boot timestamp as a concise uptime string.
 * The timestamp is an absolute UTC moment (stored server-side), so the
 * caller does not need a fresh scan to render current uptime; we just
 * compute now - lastBootAt each render.
 *
 * Output ranges:
 *   null / unparseable        -> 'unknown'
 *   future / clock skew       -> '<1h'
 *   less than 1 hour          -> '<1h'
 *   1 to 23 hours             -> 'Xh'
 *   1 to 29 days              -> 'Xd Yh' (hours dropped when zero)
 *   30+ days                  -> 'Xd' (no hours; days are what matters)
 */
export function formatUptime(lastBootAt: string | null | undefined): string {
  if (!lastBootAt) return 'unknown';
  const s = lastBootAt.endsWith('Z') ? lastBootAt : lastBootAt + 'Z';
  const bootMs = new Date(s).getTime();
  if (isNaN(bootMs)) return 'unknown';
  const deltaMs = Date.now() - bootMs;
  if (deltaMs < 0) return '<1h';
  const hours = Math.floor(deltaMs / 3_600_000);
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days < 30 && remHours > 0) return `${days}d ${remHours}h`;
  return `${days}d`;
}
