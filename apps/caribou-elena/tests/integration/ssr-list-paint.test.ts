// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Hits real fosstodon.org via the server's SSR pageData fetch. Skipped
// in CI to avoid coupling builds to upstream uptime; run locally to
// verify the cookie-only public-timeline path emits SSR cards.
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
        `Run \`pnpm --filter caribou-elena build\` before running this test.`,
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
    process.stderr.write(`[caribou-elena server] ${chunk}`)
  })
  await waitForReady(`${baseUrl}/api/health`, 15_000)
}, 30_000)

afterAll(() => {
  if (server && !server.killed) server.kill('SIGTERM')
  try { rmSync(STORAGE_DIR, { recursive: true, force: true }) } catch { /* noop */ }
})

describe.skipIf(SKIP)('SSR list-paint: /local emits status cards', () => {
  it('SSR HTML for /local contains <caribou-status-card> children inside the list-mount DSD', async () => {
    const res = await fetch(`${baseUrl}/local`, {
      headers: { Cookie: 'caribou.instance=fosstodon.org' },
    })
    expect(res.status).toBe(200)
    const body = await res.text()

    // Confirm the page hit the ok path (not auth-required).
    expect(body).toContain('"kind":"ok"')

    // Cards present.
    const cardMatches = body.match(/<caribou-status-card\s/g) ?? []
    expect(cardMatches.length).toBeGreaterThan(0)

    // <li data-key> children present.
    const liMatches = body.match(/<li data-key="/g) ?? []
    expect(liMatches.length).toBe(cardMatches.length)

    // No "No posts yet." flash.
    expect(body).not.toContain('No posts yet')

    // list-mount's DSD template is present and contains the rendered UL.
    expect(body).toMatch(/<caribou-list-mount[^>]*>\s*<template shadowrootmode="open">/)
  })
})
