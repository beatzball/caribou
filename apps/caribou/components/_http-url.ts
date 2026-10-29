// Every URL a post carries comes from a remote server. Lit escapes attribute
// values, so a URL cannot break out of `src` or `href`; this keeps out the
// schemes that would still run or embed something (`javascript:`, `data:`).
export function httpUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}
