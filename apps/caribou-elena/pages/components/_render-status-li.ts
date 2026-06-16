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

export interface RenderStatusLiOptions {
  /** Emitted as the card's `variant` attribute (e.g. 'timeline', 'focused'). Omitted → no attribute, card falls back to its own default. */
  variant?: string
  /** Emit `data-status-id` on the card so the SSR'd node matches the keyed reconciler's `create()` output. */
  statusId?: boolean
}

export function renderStatusLi(s: mastodon.v1.Status, opts?: RenderStatusLiOptions): string {
  const key = escapeHtmlAttr(s.id)
  const statusJson = escapeHtmlAttr(JSON.stringify(s))
  const variantAttr = opts?.variant ? ` variant="${escapeHtmlAttr(opts.variant)}"` : ''
  const idAttr = opts?.statusId ? ` data-status-id="${key}"` : ''
  return `<li data-key="${key}"><caribou-status-card${variantAttr}${idAttr} status="${statusJson}"></caribou-status-card></li>`
}

export function renderStatusLiList(
  items: readonly mastodon.v1.Status[],
  opts?: RenderStatusLiOptions,
): string {
  if (items.length === 0) return ''
  let out = ''
  for (const s of items) out += renderStatusLi(s, opts)
  return out
}
