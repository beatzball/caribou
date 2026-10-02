// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { html } from 'lit'
import type { Status } from '@beatzball/caribou-mastodon-client'
import { statusCache } from '@beatzball/caribou-state'
import { ssr } from './_ssr.js'
import '../../components/caribou-thread.js'
import type { ThreadInitial } from '../../components/caribou-thread.js'
import '../../pages/@[handle]/[statusId].js'
import type { StatusPageData } from '../../pages/@[handle]/[statusId].js'

const ACCOUNT = {
  id: '1', acct: 'alice@example.social', username: 'alice', displayName: 'Alice',
  avatar: 'https://example.social/a.png', avatarStatic: 'https://example.social/a.png',
}

function status(id: string, inReplyToId: string | null): Status {
  return {
    id, content: `<p>post ${id}</p>`, account: ACCOUNT, createdAt: '2026-04-28T12:00:00Z', inReplyToId,
  } as unknown as Status
}

// root → parent → FOCUSED → r1 → r2 → r3 → r4, plus a second direct reply.
const THREAD: ThreadInitial = {
  ancestors: [status('root', null), status('parent', 'root')],
  focused: status('focused', 'parent'),
  descendants: [
    status('r1', 'focused'), status('r2', 'r1'), status('r3', 'r2'), status('r4', 'r3'),
    status('s1', 'focused'),
  ],
}

// Lit wraps each binding in comment markers; drop them to read the text.
const strip = (s: string) => s.replace(/<!--[^>]*-->/g, '')

interface Row { depth: string | null; style: string | null; variant: string; id: string }

function rows(out: string): Row[] {
  return [...out.matchAll(/<li([^>]*)>\s*<caribou-status-card([^>]*)>/g)].map((m) => ({
    depth: /data-depth="(\d+)"/.exec(m[1]!)?.[1] ?? null,
    style: /style="([^"]*)"/.exec(m[1]!)?.[1] ?? null,
    variant: /variant="([a-z]+)"/.exec(m[2]!)![1]!,
    id: /data-id="([^"]+)"/.exec(m[2]!)![1]!,
  }))
}

describe('caribou-thread SSR', () => {
  const render = (initial: ThreadInitial | null) => ssr(html`
    <caribou-thread statusid="focused" .initial=${initial}></caribou-thread>
  `).then(strip)

  it('renders the whole thread on the server: ancestors, the focused post, descendants', async () => {
    const out = await render(THREAD)
    expect(rows(out).map((r) => [r.id, r.variant])).toEqual([
      ['root', 'ancestor'], ['parent', 'ancestor'],
      ['focused', 'focused'],
      ['r1', 'descendant'], ['r2', 'descendant'], ['r3', 'descendant'], ['r4', 'descendant'],
      ['s1', 'descendant'],
    ])
    expect(out).not.toContain('Loading…')
  })

  it('prints the content of every card, in thread order', async () => {
    const out = await render(THREAD)
    const order = ['root', 'parent', 'focused', 'r1', 'r2', 'r3', 'r4', 's1'].map((id) => out.indexOf(`<p>post ${id}</p>`))
    expect(order.every((at) => at > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('indents each descendant by its depth, capped at 3, and nothing above it', async () => {
    const out = await render(THREAD)
    expect(rows(out).map((r) => r.depth)).toEqual([null, null, null, '1', '2', '3', '3', '1'])
    expect(rows(out).map((r) => r.style)).toEqual([
      null, null, null,
      'margin-inline-start:calc(var(--space-4) * 1)',
      'margin-inline-start:calc(var(--space-4) * 2)',
      'margin-inline-start:calc(var(--space-4) * 3)',
      'margin-inline-start:calc(var(--space-4) * 3)',
      'margin-inline-start:calc(var(--space-4) * 1)',
    ])
  })

  it('marks each card with the depth of its row', async () => {
    const out = await render(THREAD)
    const cardDepths = [...out.matchAll(/<caribou-status-card([^>]*)>/g)]
      .map((m) => /data-depth="(\d+)"/.exec(m[1]!)?.[1] ?? null)
    expect(cardDepths).toEqual([null, null, null, '1', '2', '3', '3', '1'])
  })

  it('renders a lone status with no context', async () => {
    const out = await render({ focused: THREAD.focused, ancestors: [], descendants: [] })
    expect(rows(out)).toEqual([{ id: 'focused', variant: 'focused', depth: null, style: null }])
  })

  it('does not write the thread into an attribute', async () => {
    const out = await render(THREAD)
    expect(out).not.toMatch(/<caribou-thread [^>]*initial=/)
    expect(out).not.toMatch(/<caribou-status-card[^>]*\sstatus=/)
  })

  it('renders Loading… when it is given no thread', async () => {
    const out = await render(null)
    expect(out).toContain('<div class="loading">Loading…</div>')
  })

  // A store on the server would write every rendered status into a
  // module-level cache that no request ever clears.
  it('leaves the shared status cache untouched', async () => {
    await render(THREAD)
    expect(statusCache.value.size).toBe(0)
  })
})

describe('/@[handle]/[statusId] page SSR', () => {
  const shell = { instance: 'example.social' }
  const base = { shell, statusId: 'focused', handle: 'alice@example.social' }
  const render = (data: StatusPageData) =>
    ssr(html`<page-handle-statusid .serverData=${data}></page-handle-statusid>`).then(strip)

  it('hands the fetched thread to caribou-thread, which renders every card', async () => {
    const out = await render({ kind: 'ok', ...THREAD, ...base })
    expect(out).toMatch(/<caribou-app-shell[^>]*instance="example\.social"/)
    expect(out).toMatch(/<caribou-thread[^>]*statusid="focused"/)
    expect(rows(out).map((r) => r.variant)).toEqual([
      'ancestor', 'ancestor', 'focused', 'descendant', 'descendant', 'descendant', 'descendant', 'descendant',
    ])
    expect(out).toContain('<p>post focused</p>')
    expect(out).not.toContain('Loading…')
  })

  it('renders the instance placeholder when there is no home instance', async () => {
    const out = await render({ kind: 'auth-required', ...base, shell: { instance: null } })
    expect(out).toContain('Threads by bare handle need to know which instance to query.')
    expect(out).not.toContain('<caribou-thread')
  })

  it('renders an alert when the status could not be fetched', async () => {
    const out = await render({ kind: 'error', message: 'Error: 404', ...base })
    expect(out).toMatch(/<article role="alert">\s*Couldn't load status focused\.\s*<\/article>/)
    expect(out).not.toContain('Error: 404')
  })
})
