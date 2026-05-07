---
'caribou-elena': patch
---

Honor `PUBLIC_BASE_URL` when computing the OAuth `redirect_uri`.

The `/api/signin/start` route used to derive the redirect URI's origin straight from h3's `getRequestURL(event)`, which reads the `Host` header literally. Two problems fell out of that:

1. **Host-header spoofing.** A direct `curl -H 'Host: evil.example' .../api/signin/start` would register an OAuth app on the upstream Mastodon with `redirect_uri=https://evil.example/api/signin/callback`. State and app-storage keys are scoped per-origin so the legitimate flow keeps working, but the dangling registration is a pre-baked phishing primitive against the real instance.
2. **Reverse-proxy fragility.** h3's `getRequestURL` only consults `X-Forwarded-Host` when explicitly opted in. Ingress configurations that put the public hostname in `X-Forwarded-Host` and a service name in `Host` would silently break signin.

The route now reads `process.env.PUBLIC_BASE_URL` first; when set, that string (with any trailing slash stripped) becomes the canonical origin and the request `Host` header is ignored. When the env var is unset — dev:portless, vitest, local development — it falls back to `getRequestURL`, so nothing changes for those flows.

Production deployments should set `PUBLIC_BASE_URL=https://your-public-host` (e.g. `https://caribou.quest`).
