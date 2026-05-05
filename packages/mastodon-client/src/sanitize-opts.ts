// Mutable arrays are deliberate: DOMPurify's `Config.ALLOWED_TAGS` /
// `ALLOWED_ATTR` are typed `string[]`, so an `as const` literal would
// fail the type check at every callsite. The arrays are not modified at
// runtime — they're treated as immutable by convention.
export const PURIFY_OPTS = {
  ALLOWED_TAGS: ['p', 'br', 'a', 'span', 'em', 'strong', 'ul', 'ol', 'li', 'code', 'pre'],
  ALLOWED_ATTR: ['href', 'rel', 'target', 'class', 'lang'],
  ALLOW_DATA_ATTR: false,
}
