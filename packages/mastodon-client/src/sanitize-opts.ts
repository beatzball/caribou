// Mutable arrays are deliberate: DOMPurify's `Config.ALLOWED_TAGS` /
// `ALLOWED_ATTR` are typed `string[]`, so an `as const` literal would
// fail the type check at every callsite. The arrays are not modified at
// runtime — they're treated as immutable by convention.
export const PURIFY_OPTS = {
  ALLOWED_TAGS: ['p', 'br', 'a', 'span', 'em', 'strong', 'ul', 'ol', 'li', 'code', 'pre'],
  ALLOWED_ATTR: ['href', 'rel', 'target', 'class', 'lang'],
  ALLOW_DATA_ATTR: false,
}

interface AnchorLike {
  tagName: string
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
}

// Mastodon sends `rel="nofollow noopener noreferrer"` with `target="_blank"`,
// but other servers may not, and a new-tab link without `noopener` hands the
// opened page a reference to this window. Adds only the missing words, so
// content that already has them comes out as the same string: the server and
// the client sanitizers must agree for hydration.
export function forceSafeTargetRel(node: AnchorLike): void {
  if (node.tagName !== 'A' || node.getAttribute('target') !== '_blank') return
  const rel = (node.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean)
  const missing = ['noopener', 'noreferrer'].filter((w) => !rel.includes(w))
  if (missing.length > 0) node.setAttribute('rel', [...rel, ...missing].join(' '))
}

interface PurifyLike {
  addHook(entryPoint: 'afterSanitizeAttributes', hook: (node: AnchorLike) => void): void
}

const hooked = new WeakSet<object>()

// Hooks belong to a DOMPurify instance, and the browser's default instance is
// shared by every module that imports it, so install once per instance.
export function installPurifyHooks(purify: PurifyLike): void {
  if (hooked.has(purify)) return
  hooked.add(purify)
  purify.addHook('afterSanitizeAttributes', forceSafeTargetRel)
}
