// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Hits real fosstodon.org via the server's SSR pageData fetch (profile
// lookup + statuses, then one status + its context). Skipped in CI to avoid
// coupling builds to upstream uptime; run locally to verify that the profile
// and thread routes paint their cards from the server.
const SKIP = !!process.env.CI

// A stable public account on fosstodon.org (the instance admin).
const HANDLE = 'kev@fosstodon.org'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = resolve(__dirname, '../../dist/server/server/index.mjs')
const STORAGE_DIR = resolve(__dirname, '../../.data-ssr-profile-paint')

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

// Lit wraps each binding in comment markers; drop them to read the markup.
const strip = (s: string) => s.replace(/<!--[^>]*-->/g, '')

async function get(path: string): Promise<string> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Cookie: 'caribou.instance=fosstodon.org' },
  })
  expect(res.status).toBe(200)
  return res.text()
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

describe.skipIf(SKIP)('SSR profile-paint: /@handle emits header + status cards', () => {
  it('SSR HTML for a profile contains the header and status cards, no Loading flash', async () => {
    const raw = await get(`/@${HANDLE}`)
    const body = strip(raw)

    // Hit the ok path (not auth-required / error).
    expect(raw).toContain('"kind":"ok"')

    // Status cards present inside the profile's declarative shadow root.
    expect(body).toMatch(/<caribou-profile\s[^>]*>\s*<template shadowroot="open" shadowrootmode="open">/)
    const cardMatches = body.match(/<caribou-status-card\s/g) ?? []
    expect(cardMatches.length).toBeGreaterThan(0)

    // Each card sits in its own list item and carries the timeline variant
    // and its status id.
    expect((body.match(/<li\s*><caribou-status-card\s/g) ?? []).length).toBe(cardMatches.length)
    expect((body.match(/data-status-id="/g) ?? []).length).toBe(cardMatches.length)
    expect((body.match(/<caribou-status-card\s+variant="timeline"/g) ?? []).length).toBe(cardMatches.length)

    // Each card's own shadow root is in the HTML, with the post inside it.
    expect((body.match(/<div class="status-content">/g) ?? []).length).toBe(cardMatches.length)

    // Header SSR-painted with real account data (counts row), not empty.
    expect(body).toMatch(/<strong>\d+<\/strong> Posts/)

    // No "Loading…" flash.
    expect(body).not.toContain('Loading…')
  }, 30_000)
})

describe.skipIf(SKIP)('SSR thread-paint: /@handle/id emits the whole thread', () => {
  it('SSR HTML for a reply contains its ancestors, then the focused post, no Loading flash', async () => {
    // The `replies` tab lists statuses that sit inside a thread.
    const profile = strip(await get(`/@${HANDLE}?tab=replies`))
    const permalink = /<a class="permalink" href="(\/@[^/"]+\/\d+)"/.exec(profile)?.[1]
    expect(permalink).toBeDefined()

    const raw = await get(permalink!)
    const body = strip(raw)
    expect(raw).toContain('"kind":"ok"')
    expect(body).toMatch(/<caribou-thread\s[^>]*>\s*<template shadowroot="open" shadowrootmode="open">/)

    const variants = [...body.matchAll(/<caribou-status-card\s+variant="([a-z]+)"/g)].map((m) => m[1]!)
    expect(variants.filter((v) => v === 'focused')).toHaveLength(1)
    expect(variants).not.toContain('timeline')
    // A reply has at least one status above it, and the server puts
    // ancestors first, then the focused post, then descendants.
    expect(variants[0]).toBe('ancestor')
    const rank: Record<string, number> = { ancestor: 0, focused: 1, descendant: 2 }
    const ranks = variants.map((v) => rank[v]!)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))

    // Every card is rendered, not only listed.
    expect((body.match(/<div class="status-content">/g) ?? []).length).toBe(variants.length)

    // Each descendant row carries its depth and the matching indent.
    const descendantRows = [...body.matchAll(/<li([^>]*)><caribou-status-card\s+variant="descendant"/g)]
    expect(descendantRows.length).toBe(variants.filter((v) => v === 'descendant').length)
    for (const [, attrs] of descendantRows) {
      const depth = /data-depth="([1-3])"/.exec(attrs!)?.[1]
      expect(depth).toBeDefined()
      expect(attrs).toContain(`margin-inline-start:calc(var(--space-4) * ${depth})`)
    }

    expect(body).not.toContain('Loading…')
  }, 30_000)
})
