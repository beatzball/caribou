---
"caribou-app": patch
---

Serve the atproto OAuth client metadata at `/oauth/client-metadata.json`, built from `PUBLIC_BASE_URL`, and a handle resolver at `/xrpc/com.atproto.identity.resolveHandle`. The resolver looks up DNS and HTTPS behind an SSRF guard bound to the connection: it vets every address once, connects to that address only, and checks every redirect. Nothing in the app uses these yet.
