// Mastodon's REST API returns snake_case keys (`created_at`, `display_name`,
// `avatar_static`, …). Components consume the masto.js shape, which is
// camelCase. The home timeline path goes through masto.js and gets the
// transformation for free, but our public-API helpers do raw `fetch()` for
// SSRF-safe, cookie-host-scoped requests, so we need to do the conversion
// ourselves before the data reaches templates / `serverData`.

function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase())
}

export function camelizeKeysDeep<T = unknown>(input: unknown): T {
  if (Array.isArray(input)) {
    return input.map((v) => camelizeKeysDeep(v)) as unknown as T
  }
  if (
    input !== null &&
    typeof input === 'object' &&
    (input as { constructor?: unknown }).constructor === Object
  ) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[camel(k)] = camelizeKeysDeep(v)
    }
    return out as T
  }
  return input as T
}
