import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, addUserSession, clearKeptAlive, users,
  type ThreadStore, type UserSession,
} from '@beatzball/caribou-state'
import '../caribou-thread.js'
import type { CaribouThread, ThreadInitial } from '../caribou-thread.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'

const ACCT = { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' }

function status(id: string, inReplyToId: string | null): Status {
  return {
    id, content: `<p>${id}</p>`, account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId,
  } as unknown as Status
}

const A = status('a', null)
const B = status('b', 'a')
const F = status('f', 'b')
const C = status('c', 'f')
const D = status('d', 'c')
const E = status('e', 'd')
const G = status('g', 'e')

// One macrotask: lets the store's async work and the renders it causes finish.
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

async function mount(initial: ThreadInitial | null, statusId = 'f'): Promise<CaribouThread> {
  const el = document.createElement('caribou-thread') as CaribouThread
  el.statusId = statusId
  if (initial) el.initial = initial
  document.body.appendChild(el)
  await flush()
  await el.updateComplete
  return el
}

function cards(el: CaribouThread): CaribouStatusCard[] {
  return [...el.shadowRoot!.querySelectorAll<CaribouStatusCard>('ul > li > caribou-status-card')]
}

afterEach(() => {
  document.body.replaceChildren()
  clearKeptAlive()
  activeUserKey.value = null
  users.value = new Map()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('<caribou-thread> indent cap at depth 3', () => {
  it('caps depth at 3 for descendants more than 3 levels below focused', async () => {
    const el = await mount({ focused: F, ancestors: [A, B], descendants: [C, D, E, G] })
    const depths = cards(el).filter((c) => c.hasAttribute('data-depth')).map((c) => Number(c.dataset.depth))
    expect(depths).toEqual([1, 2, 3, 3])
  })

  it('renders ancestors (no indent), focused, then descendants (indented)', async () => {
    const el = await mount({ focused: F, ancestors: [A, B], descendants: [C] })
    const all = cards(el)
    expect(all.map((c) => c.dataset.id)).toEqual(['a', 'b', 'f', 'c'])
    expect(all.map((c) => c.getAttribute('variant'))).toEqual(['ancestor', 'ancestor', 'focused', 'descendant'])
    expect(all.map((c) => c.status)).toEqual([A, B, F, C])
  })

  it('indents each descendant row by its depth and leaves the rows above alone', async () => {
    const el = await mount({ focused: F, ancestors: [A], descendants: [C, D] })
    const rows = [...el.shadowRoot!.querySelectorAll<HTMLLIElement>('ul > li')]
    expect(rows.map((li) => li.dataset.depth)).toEqual([undefined, undefined, '1', '2'])
    expect(rows.map((li) => li.getAttribute('style'))).toEqual([
      null, null,
      'margin-inline-start:calc(var(--space-4) * 1)',
      'margin-inline-start:calc(var(--space-4) * 2)',
    ])
  })
})

describe('<caribou-thread> — depth recompute on descendant arrival', () => {
  it('recomputes data-depth on existing <li> when reparenting shifts depth', async () => {
    const F2 = status('f', null)
    // E replies to a status that is not in the tree yet, so it starts at the
    // deepest indent.
    const E2 = status('e', 'd')
    const el = await mount({ focused: F2, ancestors: [], descendants: [E2] })

    const cardBefore = el.shadowRoot!.querySelector<CaribouStatusCard>('caribou-status-card[data-id="e"]')!
    const liBefore = cardBefore.parentElement as HTMLLIElement
    expect(liBefore.dataset.depth).toBe('3')

    // D arrives and makes E a real depth-2 descendant of F (F → D → E).
    const D2 = status('d', 'f')
    const store = (el as unknown as { store: ThreadStore }).store
    store._testOnlySetDescendants([D2, E2] as Parameters<ThreadStore['_testOnlySetDescendants']>[0])
    await el.updateComplete

    const cardAfter = el.shadowRoot!.querySelector<CaribouStatusCard>('caribou-status-card[data-id="e"]')!
    expect(cardAfter).toBe(cardBefore)
    expect(cardAfter.parentElement).toBe(liBefore)
    expect(liBefore.dataset.depth).toBe('2')
    expect(cardAfter.dataset.depth).toBe('2')
    expect(liBefore.getAttribute('style')).toBe('margin-inline-start:calc(var(--space-4) * 2)')
    expect(cards(el).map((c) => c.dataset.id)).toEqual(['f', 'd', 'e'])
  })
})

describe('<caribou-thread> — data source', () => {
  it('makes no request when the server sent the thread, signed in or not', async () => {
    const el = await mount({ focused: F, ancestors: [], descendants: [] })
    expect(cards(el).length).toBe(1)
    expect(el.shadowRoot!.querySelector('.loading')).toBeNull()
  })

  it('shows Loading… when it has neither a thread nor a client', async () => {
    const el = await mount(null)
    expect(el.shadowRoot!.querySelector('.loading')?.textContent).toBe('Loading…')
    expect(cards(el).length).toBe(0)
  })

  it('loads the thread through the signed-in client when it has no initial', async () => {
    addUserSession({
      userKey: 'alice@example.social', server: 'example.social', token: 'TOKEN',
      vapidKey: '', account: ACCT, createdAt: 1,
    } as unknown as UserSession)
    const client = activeClient.value!
    const fetchStatus = vi.spyOn(client, 'fetchStatus').mockResolvedValue(F)
    const fetchThread = vi.spyOn(client, 'fetchThread').mockResolvedValue({ ancestors: [B], descendants: [C] })
    const el = await mount(null)
    await flush()
    await el.updateComplete
    expect(fetchStatus).toHaveBeenCalledWith('f')
    expect(fetchThread).toHaveBeenCalledWith('f')
    expect(cards(el).map((c) => c.dataset.id)).toEqual(['b', 'f', 'c'])
  })

  it('reflects the status id to the statusid attribute', async () => {
    const el = await mount({ focused: F, ancestors: [], descendants: [] })
    expect(el.getAttribute('statusid')).toBe('f')
  })
})

describe('<caribou-thread> — fresh thread on a revisit', () => {
  it('updates the posts in place and adds a new reply at the end', async () => {
    const el = await mount({ focused: F, ancestors: [A], descendants: [C] })
    const H = status('h', 'f')
    el.initial = {
      focused: { ...F, content: '<p>edited</p>' } as Status, ancestors: [A], descendants: [H, C],
    }
    await flush()
    await el.updateComplete
    expect(cards(el).map((c) => c.getAttribute('data-id'))).toEqual(['a', 'f', 'c', 'h'])
    expect(cards(el)[1]!.status!.content).toBe('<p>edited</p>')
  })
})

describe('<caribou-thread> — next revisit', () => {
  it('paints the replies in the order the reader last saw', async () => {
    const R1 = status('r1', 'f')
    const R2 = status('r2', 'f')
    const CHILD = status('child', 'r1')
    const first = await mount({ focused: F, ancestors: [], descendants: [R1, R2] })
    first.initial = { focused: F, ancestors: [], descendants: [R1, CHILD, R2] }
    await flush()
    await first.updateComplete
    expect(cards(first).map((c) => c.getAttribute('data-id'))).toEqual(['f', 'r1', 'r2', 'child'])
    first.remove()

    // The page cache paints the snapshot it saved: the server's order.
    const again = await mount({ focused: F, ancestors: [], descendants: [R1, CHILD, R2] })
    expect(cards(again).map((c) => c.getAttribute('data-id'))).toEqual(['f', 'r1', 'r2', 'child'])
  })
})

describe('<caribou-thread> content warnings', () => {
  it('each card in the thread collapses its own content warning', async () => {
    const cw = (s: Status) => ({ ...s, spoilerText: `cw ${s.id}` }) as unknown as Status
    const el = await mount({ focused: cw(F), ancestors: [A], descendants: [cw(C)] })
    const all = cards(el)
    await Promise.all(all.map((c) => c.updateComplete))
    expect(all.map((c) => c.shadowRoot!.querySelector('.spoiler')?.textContent ?? null)).toEqual([null, 'cw f', 'cw c'])
    expect(all.map((c) => c.shadowRoot!.querySelector('.status-content') !== null)).toEqual([true, false, false])
  })
})
