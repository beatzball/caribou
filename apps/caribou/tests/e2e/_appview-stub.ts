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
  close(): Promise<void>
}

export async function startAppViewStub(): Promise<AppViewStub> {
  const requests: string[] = []
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    requests.push(`${url.pathname}${url.search}`)
    const method = url.pathname.startsWith('/xrpc/') ? url.pathname.slice('/xrpc/'.length) : ''
    const { status, body } = appviewAnswer(method, url.searchParams)
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = addr && typeof addr === 'object' ? addr.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
