// A local stand-in for the public AppView (app README, "Bluesky SSR"). A
// spec starts it, points the test server's `BLUESKY_PUBLIC_APPVIEW` at it,
// and the server never reaches the real AppView. It answers from the shared
// fixtures in `packages/bluesky-client/src/__fixtures__/ssr-appview.ts`, and
// records every request so a spec can say "no fetch".

import { createServer, type Server } from 'node:http'
import { appviewAnswer } from '../../../../packages/bluesky-client/src/__fixtures__/ssr-appview.js'

export interface AppViewStub {
  url: string
  /** Every request path and query the stub saw, in order. */
  requests: string[]
  /** The same, from the test server only (no `Origin` header): the browser's own reads are left out. */
  serverRequests: string[]
  /** Answer the next `times` calls of `method` with a 429 and this `Retry-After`. */
  rateLimit(method: string, times: number, retryAfter: string): void
  close(): Promise<void>
}

export async function startAppViewStub(): Promise<AppViewStub> {
  const requests: string[] = []
  const serverRequests: string[] = []
  const limits = new Map<string, { times: number; retryAfter: string }>()
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    const line = `${url.pathname}${url.search}`
    requests.push(line)
    if (!req.headers.origin) serverRequests.push(line)
    const method = url.pathname.startsWith('/xrpc/') ? url.pathname.slice('/xrpc/'.length) : ''
    // The browser reads the AppView itself after a 429 (#187), as it does
    // the real one, which allows any origin.
    const cors = { 'access-control-allow-origin': '*' }
    const limit = limits.get(method)
    if (limit && limit.times > 0) {
      limit.times--
      res.writeHead(429, { ...cors, 'content-type': 'application/json', 'retry-after': limit.retryAfter })
      res.end(JSON.stringify({ error: 'RateLimitExceeded' }))
      return
    }
    const { status, body } = appviewAnswer(method, url.searchParams)
    res.writeHead(status, { ...cors, 'content-type': 'application/json', 'cache-control': 'public, max-age=30' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = addr && typeof addr === 'object' ? addr.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    serverRequests,
    rateLimit: (method, times, retryAfter) => { limits.set(method, { times, retryAfter }) },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
