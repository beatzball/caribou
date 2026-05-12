import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = resolve(__dirname, '../../dist/server/server/index.mjs')

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

let server: ChildProcess | undefined
let baseUrl = ''

beforeAll(async () => {
  if (!existsSync(SERVER_PATH)) {
    throw new Error(
      `Server bundle not found at ${SERVER_PATH}.\n` +
        `Run \`pnpm --filter caribou-elena build\` before running this test.`,
    )
  }
  const port = await getFreePort()
  baseUrl = `http://localhost:${port}`
  server = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Surface server errors so a crash during ready-wait shows up clearly.
  server.stderr?.on('data', (chunk) => {
    process.stderr.write(`[caribou-elena server] ${chunk}`)
  })
  await waitForReady(`${baseUrl}/api/health`, 15_000)
}, 30_000)

afterAll(() => {
  if (server && !server.killed) server.kill('SIGTERM')
})

const ROUTES = ['/local', '/public', '/home', '/@me'] as const

describe.each(ROUTES)('SSR slot composition: %s', (route) => {
  let body = ''

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}${route}`)
    expect(res.status, `${route} should return 200`).toBe(200)
    body = await res.text()
  })

  it('emits at least one <template shadowrootmode> wrapper', () => {
    expect(body).toMatch(/<template shadowrootmode="(open|closed)">/)
  })

  it('places <caribou-auth-required> inside <caribou-app-shell> as a light-DOM child', () => {
    const shellMatch = body.match(/<caribou-app-shell\b[^>]*>([\s\S]*?)<\/caribou-app-shell>/)
    expect(shellMatch, 'response should contain <caribou-app-shell>').not.toBeNull()
    // Strip the shadow-root template; what remains is the host's light-DOM children.
    const lightChildren = shellMatch![1].replace(
      /<template shadowrootmode="[^"]*">[\s\S]*?<\/template>/g,
      '',
    )
    expect(lightChildren).toContain('<caribou-auth-required')
  })

  it('has no literal <slot></slot> outside a <template shadowrootmode>', () => {
    const stripped = body.replace(
      /<template shadowrootmode="[^"]*">[\s\S]*?<\/template>/g,
      '',
    )
    expect(stripped).not.toMatch(/<slot(?:\s[^>]*)?><\/slot>/)
  })

  it('__litro_data__ has kind="auth-required" when no instance cookie is set', () => {
    const match = body.match(
      /<script type="application\/json" id="__litro_data__">([^<]+)<\/script>/,
    )
    expect(match, 'response should contain __litro_data__').not.toBeNull()
    const data = JSON.parse(match![1]) as { kind: string }
    expect(data.kind).toBe('auth-required')
  })
})
