#!/usr/bin/env node
/* eslint-disable no-console */
import { execSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.env.CARIBOU_BASE_URL ?? 'https://caribou.quest').replace(/\/$/, '')
const EXPECTED_SHA = (() => {
  const fromEnv = process.env.GITHUB_SHA?.trim()
  if (fromEnv) return fromEnv
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return null
  }
})()

// Retry budget is sized to absorb Coolify's build + container-swap window,
// which runs asynchronously after the deploy webhook returns. A fresh build
// is typically ready in 60–120s; we budget 4 minutes per check to stay
// comfortably above that without blocking CI forever.
const RETRIES = 30
const DELAY_MS = 8000
const FETCH_TIMEOUT_MS = 10_000

async function fetchWithTimeout(url, init) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function withRetry(name, fn) {
  const start = Date.now()
  let lastErr
  for (let i = 1; i <= RETRIES; i++) {
    try {
      await fn()
      const ms = Date.now() - start
      console.log(`  PASS  ${name.padEnd(40)} (${ms}ms, attempt ${i}/${RETRIES})`)
      return { name, ok: true, ms }
    } catch (e) {
      lastErr = e
      if (i < RETRIES) await sleep(DELAY_MS)
    }
  }
  const ms = Date.now() - start
  console.log(`  FAIL  ${name.padEnd(40)} (${ms}ms, ${RETRIES}/${RETRIES})`)
  console.log(`        ${String(lastErr?.message ?? lastErr)}`)
  return { name, ok: false, ms, err: lastErr }
}

async function checkLanding() {
  const res = await fetchWithTimeout(`${BASE}/`)
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`)
  const body = await res.text()
  if (!/Caribou/.test(body)) throw new Error('body missing "Caribou"')
}

async function checkHealth() {
  const res = await fetchWithTimeout(`${BASE}/api/health`)
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`)
  const body = await res.json()
  if (body.status !== 'ok') throw new Error(`status: ${body.status}`)
  if (typeof body.commit !== 'string' || body.commit.length === 0) {
    throw new Error('missing/empty commit in payload')
  }
  if (EXPECTED_SHA && body.commit !== EXPECTED_SHA) {
    throw new Error(
      `commit mismatch — deployed ${String(body.commit).slice(0, 8)}, expected ${EXPECTED_SHA.slice(0, 8)}`,
    )
  }
}

// /feed's auth gate is client-side (FeedPage.connectedCallback calls
// location.replace('/') when there's no activeUserKey). The server-side
// render returns 200 HTML regardless. Probe the route exists and serves
// HTML — the client-side gate is covered by E2E.
async function checkFeedRoute() {
  const res = await fetchWithTimeout(`${BASE}/feed`)
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`)
  const ctype = res.headers.get('content-type') ?? ''
  if (!/text\/html/i.test(ctype)) throw new Error(`expected text/html, got ${ctype}`)
}

// Exercise the OAuth init endpoint with a guaranteed-unreachable instance.
// Proves routing + body parsing + downstream fetch wiring without registering
// a real OAuth app on a public Mastodon instance (no persistent side effects).
async function checkSigninStart() {
  const res = await fetchWithTimeout(`${BASE}/api/signin/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ server: 'caribou-probe-nonexistent.invalid' }),
  })
  if (res.status !== 502) {
    throw new Error(`expected 502 for unreachable instance, got ${res.status}`)
  }
}

console.log(
  `Verifying ${BASE}${EXPECTED_SHA ? ` (expecting commit ${EXPECTED_SHA.slice(0, 8)})` : ' (no SHA pin)'}`,
)

const results = []
results.push(await withRetry('GET  /', checkLanding))
results.push(await withRetry('GET  /api/health', checkHealth))
results.push(await withRetry('GET  /feed (route)', checkFeedRoute))
results.push(await withRetry('POST /api/signin/start (oauth init)', checkSigninStart))

const failed = results.filter((r) => !r.ok)
if (failed.length > 0) {
  console.error(`\n${failed.length}/${results.length} checks failed`)
  process.exit(1)
}
console.log(`\nAll ${results.length} checks passed`)
