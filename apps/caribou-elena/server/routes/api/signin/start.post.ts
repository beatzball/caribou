import { defineEventHandler, readBody, getRequestURL, createError } from 'h3'
import { startSignin, registerMastodonApp } from '../../../lib/signin-start.js'
import { getStorage } from '../../../lib/storage.js'

// Origin → OAuth redirect_uri.
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

export default defineEventHandler(async (event) => {
  const body = await readBody<{ server?: string }>(event)
  if (!body || typeof body.server !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'server is required' })
  }
  const origin = resolveOrigin(event)
  try {
    return await startSignin({ server: body.server, origin }, {
      storage: getStorage(),
      registerApp: registerMastodonApp,
    })
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: `instance unreachable: ${(err as Error).message}`,
    })
  }
})
