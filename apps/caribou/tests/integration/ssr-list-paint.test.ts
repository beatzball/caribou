// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Hits real fosstodon.org via the server's SSR pageData fetch. Skipped
// in CI to avoid coupling builds to upstream uptime; run locally (after
// `pnpm --filter caribou-app build`) to verify the cookie-only
// public-timeline path emits SSR cards.
const SKIP = !!process.env.CI

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = resolve(__dirname, '../../dist/server/server/index.mjs')
const STORAGE_DIR = resolve(__dirname, '../../.data-ssr-list-paint')

function getFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.on('error', rej)
    srv.listen(0, () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => res(port))
      } else {
        srv.close()
        rej(new Error('Failed to acquire free port'))
      }
    })
  })
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch { /* keep trying */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`)
}

function seedOAuthApp(port: number): void {
  // resolveInstanceForRoute requires an OAuth app under `apps:${host}:${origin}`
  // to consider the cookie's hostname trusted. The fs driver maps colons to
  // path separators; the file at `apps/fosstodon.org/http/localhost/${port}`
  // is what `getInstance` finds via `storage.getKeys('apps:fosstodon.org:')`.
  const appDir = resolve(STORAGE_DIR, 'apps/fosstodon.org/http/localhost')
  mkdirSync(appDir, { recursive: true })
  writeFileSync(
    resolve(appDir, String(port)),
    JSON.stringify({
      client_id: 'dummy',
      client_secret: 'dummy',
      vapid_key: 'dummy',
      registered_at: Date.now(),
    }),
  )
}

let server: ChildProcess | undefined
let baseUrl = ''

beforeAll(async () => {
  if (SKIP) return
  if (!existsSync(SERVER_PATH)) {
    throw new Error(
      `Server bundle not found at ${SERVER_PATH}.\n` +
        `Run \`pnpm --filter caribou-app build\` before running this test.`,
    )
  }
  const port = await getFreePort()
  baseUrl = `http://localhost:${port}`
  seedOAuthApp(port)
  server = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: String(port), STORAGE_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stderr?.on('data', (chunk) => {
    process.stderr.write(`[caribou-app server] ${chunk}`)
  })
  await waitForReady(`${baseUrl}/api/health`, 15_000)
}, 30_000)

afterAll(() => {
  if (server && !server.killed) server.kill('SIGTERM')
  try { rmSync(STORAGE_DIR, { recursive: true, force: true }) } catch { /* noop */ }
})

describe.skipIf(SKIP)('SSR list-paint: timelines arrive with their status cards', () => {
  it.each(['/local', '/public'])('SSR HTML for %s contains rendered status cards', async (path) => {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Cookie: 'caribou.instance=fosstodon.org' },
    })
    expect(res.status).toBe(200)
    const body = await res.text()

    // Confirm the page hit the ok path (not auth-required).
    expect(body).toContain('"kind":"ok"')

    // The timeline's declarative shadow root holds the list.
    expect(body).toMatch(/<caribou-timeline[^>]*><template shadowroot="open" shadowrootmode="open">/)

    // Cards present, one per <li>.
    const cardMatches = body.match(/<caribou-status-card\s/g) ?? []
    expect(cardMatches.length).toBeGreaterThan(0)
    const liMatches = body.match(/<li><!--lit-node \d+--><caribou-status-card\s/g) ?? []
    expect(liMatches.length).toBe(cardMatches.length)

    // Each card is rendered, not an empty shell waiting for JavaScript.
    const articles = body.match(/<article data-variant="timeline">/g) ?? []
    expect(articles.length).toBe(cardMatches.length)
    const permalinks = body.match(/<a class="permalink" href="\/@[^"]+"/g) ?? []
    expect(permalinks.length).toBe(cardMatches.length)

    // No "No posts yet." flash.
    expect(body).not.toContain('No posts yet')

    // The no-JS pagination link is in the markup.
    expect(body).toMatch(/<a href="\?max_id=[^"]+" rel="next" data-sentinel/)

    // The data is not also serialized into attributes.
    expect(body).not.toMatch(/<caribou-(timeline|status-card)[^>]*\s(initial|status)="/)
  })

  it('?max_id= pages the server render', async () => {
    const headers = { Cookie: 'caribou.instance=fosstodon.org' }
    const first = await (await fetch(`${baseUrl}/local`, { headers })).text()
    const next = first.match(/<a href="\?max_id=([^"]+)" rel="next"/)?.[1]
    expect(next).toBeTruthy()
    const second = await (await fetch(`${baseUrl}/local?max_id=${next}`, { headers })).text()
    expect(second).toContain('"kind":"ok"')
    const ids = (html: string) => [...html.matchAll(/data-status-id="([^"]+)"/g)].map((m) => m[1])
    expect(ids(second).length).toBeGreaterThan(0)
    expect(ids(second)).not.toContain(next)
    for (const id of ids(second)) expect(ids(first)).not.toContain(id)
  })
})
