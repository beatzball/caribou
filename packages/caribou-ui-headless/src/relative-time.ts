// Compact relative-time formatter for status timestamps. Six ranges:
//   <30s          → "just now"
//   <60m          → "{m}m"
//   <24h          → "{h}h"
//   <7d           → "{d}d"
//   same year     → "{Mon} {day}"           (e.g. "Apr 14")
//   different yr  → "{Mon} {day}, {year}"   (e.g. "Apr 14, 2025")
//
// Negative deltas (clock skew, future timestamps) clamp to 0 so we render
// "just now" rather than a misleading "-5m".

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatRelativeTime(iso: string, nowMs?: number): string {
  const t = new Date(iso).getTime()
  const n = nowMs ?? Date.now()
  const deltaSec = Math.max(0, Math.floor((n - t) / 1000))

  if (deltaSec < 30) return 'just now'
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m`
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h`
  if (deltaSec < 86_400 * 7) return `${Math.floor(deltaSec / 86_400)}d`

  const d = new Date(iso)
  const nowDate = new Date(n)
  const sameYear = d.getUTCFullYear() === nowDate.getUTCFullYear()
  const month = MONTHS[d.getUTCMonth()]
  return sameYear
    ? `${month} ${d.getUTCDate()}`
    : `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
