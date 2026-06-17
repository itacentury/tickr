/**
 * Pure formatting and data-shaping helpers for the metrics dashboard.
 *
 * No DOM access; shared between the dashboard sections and the SVG chart builders.
 */

/**
 * Collapse a status-code map into 2xx / 4xx / 5xx totals.
 *
 * @param {object} byStatus - Map of status code (string) to request count.
 * @returns {{s2: number, s4: number, s5: number}} Bucketed totals.
 */
export function statusBuckets(byStatus) {
  const buckets = { s2: 0, s4: 0, s5: 0 };
  for (const [code, count] of Object.entries(byStatus)) {
    if (code.startsWith("2")) buckets.s2 += count;
    else if (code.startsWith("4")) buckets.s4 += count;
    else if (code.startsWith("5")) buckets.s5 += count;
  }
  return buckets;
}

/**
 * Format seconds into a human-readable uptime string.
 *
 * @param {number} seconds - Total uptime in seconds.
 * @returns {string} Formatted string like "3d 10h 17m".
 */
export function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const min = Math.floor((seconds % 3600) / 60);

  if (d > 0) return `${d}d ${h}h ${min}m`;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}m`;
}

/** Format a duration in seconds as "Xm Ys" or "Ys". */
export function formatDuration(seconds) {
  if (!seconds) return "—";
  const min = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return min > 0 ? `${min}m ${s}s` : `${s}s`;
}

/** Format "seconds ago" as a relative label, or "—" when null. */
export function formatAgo(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
