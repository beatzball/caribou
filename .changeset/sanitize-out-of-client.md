---
"caribou-app": patch
---

Keep the server-only sanitizer out of the client bundle. The pages reach
`server/lib/sanitize.ts` with a dynamic `import()`, so the browser never
downloaded it, but Vite still emitted the jsdom-backed module as a 2.7 MB
lazy chunk in `dist/client/assets`. The client build now resolves it to a
throwing stub, the same way it already stubs `unstorage`; the server and the
unit tests keep the real module.
