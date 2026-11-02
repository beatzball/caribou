// Runs scripts/ci/coolify-deploy.sh against a fake Coolify API.
// Run: node --test scripts/ci/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'coolify-deploy.sh')
const NEW = 'b'.repeat(40)
const OLD = 'a'.repeat(40)
const APP = 'app-uuid'
const DEP = 'dep-uuid'

// opts:
//   active:     answers of the "active deployments" list, one per call (then 0)
//   buildPack:  the app's build_pack
//   statuses:   deployment statuses, one per poll (the last one repeats)
//   skipped:    GET /deployments/<id> answers 404
//   cancelCode: HTTP status of the cancel call
//   appReadFailsAfterFinish: GET app answers 500 once the deploy finished
function fakeCoolify(opts = {}) {
  const state = { tag: OLD, calls: [], polls: 0, finished: false }
  const active = [...(opts.active ?? [])]
  const statuses = opts.statuses ?? ['in_progress', 'finished']
  const server = createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      if (req.headers.authorization !== 'Bearer test-token') return send(401, { message: 'Unauthenticated.' })
      const path = req.url.replace(/^\/api\/v1/, '')
      state.calls.push(`${req.method} ${path}`)
      if (req.method === 'GET' && path.startsWith(`/deployments/applications/${APP}`)) {
        const n = active.length ? active.shift() : 0
        return send(200, { count: n, deployments: Array.from({ length: n }, () => ({ status: 'in_progress' })) })
      }
      if (req.method === 'GET' && path === `/applications/${APP}`) {
        if (opts.appReadFailsAfterFinish && state.finished) return send(500, { message: 'oops' })
        return send(200, { build_pack: opts.buildPack ?? 'dockerimage', docker_registry_image_tag: state.tag })
      }
      if (req.method === 'PATCH' && path === `/applications/${APP}`) {
        state.tag = JSON.parse(data).docker_registry_image_tag
        return send(200, { uuid: APP })
      }
      if (req.method === 'POST' && path === `/deploy?uuid=${APP}&force=false`) {
        return send(200, { deployments: [{ message: 'Deployment request queued.', resource_uuid: APP, deployment_uuid: DEP }] })
      }
      if (req.method === 'GET' && path === `/deployments/${DEP}`) {
        if (opts.skipped) return send(404, { message: 'Deployment not found.' })
        const status = statuses[Math.min(state.polls++, statuses.length - 1)]
        if (status === 'finished') state.finished = true
        return send(200, { status })
      }
      if (req.method === 'POST' && path === `/deployments/${DEP}/cancel`) {
        return send(opts.cancelCode ?? 200, { message: 'x' })
      }
      send(404, { message: 'not found' })
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state })))
}

function run(apiUrl, env = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'coolify-deploy-'))
  return new Promise((resolve) => {
    const child = spawn('bash', [SCRIPT], {
      env: {
        PATH: process.env.PATH,
        COOLIFY_API_URL: apiUrl,
        COOLIFY_API_TOKEN: 'test-token',
        COOLIFY_APP_UUID: APP,
        GITHUB_SHA: NEW,
        IMAGE: `ghcr.io/example/caribou:${NEW}`,
        RUNNER_TEMP: temp,
        COOLIFY_POLL_SECONDS: '0.05',
        COOLIFY_WAIT_BUDGET: '5',
        COOLIFY_DEPLOY_BUDGET: '5',
        ...env,
      },
    })
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (out += c))
    child.on('close', (code) => {
      rmSync(temp, { recursive: true, force: true })
      resolve({ code, out })
    })
  })
}

async function scenario(opts, env) {
  const { server, state } = await fakeCoolify(opts)
  const url = `http://127.0.0.1:${server.address().port}/api/v1/`
  try {
    return { ...(await run(url, env)), state, host: `127.0.0.1:${server.address().port}` }
  } finally {
    server.close()
  }
}

const has = (state, call) => state.calls.some((c) => c.startsWith(call))

test('deploys and leaves the tag on the new SHA', async () => {
  const r = await scenario()
  assert.equal(r.code, 0, r.out)
  assert.equal(r.state.tag, NEW)
  assert.match(r.out, /Deployed ghcr\.io\/example\/caribou/)
  assert.ok(!r.out.includes('test-token'))
})

test('waits for another active deployment to end first', async () => {
  const r = await scenario({ active: [1, 2] })
  assert.equal(r.code, 0, r.out)
  assert.equal(r.state.calls.filter((c) => c.startsWith(`GET /deployments/applications/`)).length, 3)
  assert.equal(r.state.tag, NEW)
})

test('refuses an app that is not a Docker Image app, without touching it', async () => {
  const r = await scenario({ buildPack: 'dockerfile' })
  assert.equal(r.code, 1)
  assert.match(r.out, /not a Docker Image app/)
  assert.ok(!has(r.state, 'PATCH'))
})

test('a failed deployment puts the tag back and does not cancel', async () => {
  const r = await scenario({ statuses: ['in_progress', 'failed'] })
  assert.equal(r.code, 1)
  assert.equal(r.state.tag, OLD)
  assert.ok(!has(r.state, `POST /deployments/${DEP}/cancel`))
  assert.match(r.out, /ended as failed/)
})

test('a deploy Coolify did not queue leaves the tag and says the state is unknown', async () => {
  const r = await scenario({ skipped: true })
  assert.equal(r.code, 1)
  assert.equal(r.state.tag, NEW)
  assert.match(r.out, /did not queue the deploy/)
  assert.match(r.out, /state in Coolify is unknown/)
})

test('a timeout cancels, leaves the tag and says the state is unknown', async () => {
  const r = await scenario({ statuses: ['in_progress'] }, { COOLIFY_DEPLOY_BUDGET: '1' })
  assert.equal(r.code, 1)
  assert.ok(has(r.state, `POST /deployments/${DEP}/cancel`))
  assert.equal(r.state.tag, NEW)
  assert.match(r.out, /accepted the cancel/)
  assert.match(r.out, /did not finish in time/)
  assert.match(r.out, /state in Coolify is unknown/)
})

test('a timeout with a refused cancel still leaves the tag', async () => {
  const r = await scenario({ statuses: ['in_progress'], cancelCode: 500 }, { COOLIFY_DEPLOY_BUDGET: '1' })
  assert.equal(r.code, 1)
  assert.equal(r.state.tag, NEW)
  assert.match(r.out, /did not accept the cancel .*HTTP 500/)
  assert.ok(!r.state.calls.slice(r.state.calls.indexOf(`POST /deployments/${DEP}/cancel`)).some((c) => c.startsWith('PATCH')))
})

test('a failed read-back after a finished deploy warns but passes', async () => {
  const r = await scenario({ appReadFailsAfterFinish: true })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /could not be read back \(HTTP 500\)/)
})

test('no answer from Coolify fails without printing the host', async () => {
  const r = await run('http://coolify-host.invalid/api/v1')
  assert.equal(r.code, 1)
  assert.match(r.out, /HTTP 000/)
  assert.ok(!r.out.includes('coolify-host'))
})
