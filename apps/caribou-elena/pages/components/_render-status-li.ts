import type { mastodon } from 'masto'

// Order matters: `&` first so we don't double-escape entities we introduce.
const ENTITY: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
}
function escapeHtmlAttr(s: string): string {
  return s.replace(/[&"'<>]/g, (c) => ENTITY[c]!)
}

export function renderStatusLi(s: mastodon.v1.Status): string {
  const key = escapeHtmlAttr(s.id)
  const statusJson = escapeHtmlAttr(JSON.stringify(s))
  return `<li data-key="${key}"><caribou-status-card status="${statusJson}"></caribou-status-card></li>`
}

export function renderStatusLiList(items: readonly mastodon.v1.Status[]): string {
  if (items.length === 0) return ''
  let out = ''
  for (const s of items) out += renderStatusLi(s)
  return out
}
