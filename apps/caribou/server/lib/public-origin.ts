import { getRequestURL } from 'h3'

// The public origin of this deployment. Sign-in builds the OAuth
// redirect_uri from it, and the page head builds absolute og:image URLs.
//
// `PUBLIC_BASE_URL` is the canonical public origin (e.g. `https://caribou.quest`).
// When set, it overrides the request's Host header. This matters because:
//
// 1. Host-header spoofing — without it, anyone can `curl -H 'Host: evil.example'`
//    and we'll register an OAuth app with `redirect_uri=https://evil.example/...`
//    against the real upstream Mastodon, polluting storage and creating a
//    pre-baked phishing primitive (state/app keys are scoped per-origin so the
//    legitimate flow is unaffected, but the dangling registration is still ugly).
// 2. Reverse-proxy fragility — h3's `getRequestURL` reads `Host` literally and
//    only honors `X-Forwarded-Host` when explicitly opted in. Some ingress
//    setups put the public hostname in `X-Forwarded-Host` and a service name
//    in `Host`; signin would silently break under those.
//
// In dev (and tests) `PUBLIC_BASE_URL` is unset and we fall back to the request
// URL so dev:portless on `127.0.0.1:PORT` still works.
export function resolveOrigin(event: Parameters<typeof getRequestURL>[0]): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const url = getRequestURL(event)
  return `${url.protocol}//${url.host}`
}
