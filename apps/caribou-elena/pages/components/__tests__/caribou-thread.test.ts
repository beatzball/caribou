import { describe, it, expect, beforeAll } from 'vitest'
import type { CaribouListMount } from '../caribou-list-mount.js'

beforeAll(async () => { await import('../caribou-thread.js') })

const ACCT = { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' }
const A = { id: 'a', content: '<p>a</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: null }
const B = { id: 'b', content: '<p>b</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'a' }
const F = { id: 'f', content: '<p>f</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'b' }
const C = { id: 'c', content: '<p>c</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'f' }
const D = { id: 'd', content: '<p>d</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'c' }
const E = { id: 'e', content: '<p>e</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'd' }
const G = { id: 'g', content: '<p>g</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'e' }

import type { ThreadStore } from '@beatzball/caribou-state'

describe('<caribou-thread> indent cap at depth 3', () => {
  it('caps depth at 3 for descendants more than 3 levels below focused', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-thread') as HTMLElement & { initial: unknown; statusid: string }
    el.statusid = 'f'
    el.initial = { focused: F, ancestors: [A, B], descendants: [C, D, E, G] }
    document.body.appendChild(el)
    // Flush a few microtasks: the thread yields once in connectedCallback
    // before reading `this.initial`, then creates the store, then the
    // signals effect schedules a requestUpdate. Each step costs at least
    // one microtask, so chain awaits until the shadow tree settles.
    await new Promise((r) => setTimeout(r, 0))
    const mount = el.shadowRoot!.querySelector<CaribouListMount>('caribou-list-mount')
    const cards = mount!.mountUl.querySelectorAll('caribou-status-card[data-depth]')
    const depths = Array.from(cards).map((c) => Number((c as HTMLElement).dataset.depth))
    expect(Math.max(...depths)).toBeLessThanOrEqual(3)
  })

  it('renders ancestors (no indent), focused, then descendants (indented)', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-thread') as HTMLElement & { initial: unknown; statusid: string }
    el.statusid = 'f'
    el.initial = { focused: F, ancestors: [A, B], descendants: [C] }
    document.body.appendChild(el)
    // Flush a few microtasks: the thread yields once in connectedCallback
    // before reading `this.initial`, then creates the store, then the
    // signals effect schedules a requestUpdate. Each step costs at least
    // one microtask, so chain awaits until the shadow tree settles.
    await new Promise((r) => setTimeout(r, 0))
    const mount = el.shadowRoot!.querySelector<CaribouListMount>('caribou-list-mount')
    const cards = mount!.mountUl.querySelectorAll('caribou-status-card')
    expect(cards.length).toBe(4)
    const variants = Array.from(cards).map((c) => c.getAttribute('variant'))
    expect(variants).toEqual(['ancestor', 'ancestor', 'focused', 'descendant'])
  })
})

describe('<caribou-thread> — depth recompute on descendant arrival', () => {
  it('recomputes data-depth on existing <li> when reparenting shifts depth', async () => {
    document.body.innerHTML = ''
    const ACCT2 = { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' }
    const F2 = { id: 'f', content: '<p>f</p>', account: ACCT2, createdAt: '2026-04-28T12:00:00Z', inReplyToId: null }
    // E is a "leaf" with inReplyToId pointing at a status NOT yet in the tree.
    // depthMap should fall back to MAX_DEPTH for it initially.
    const E2 = { id: 'e', content: '<p>e</p>', account: ACCT2, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'd' }

    const el = document.createElement('caribou-thread') as HTMLElement & {
      initial: unknown; statusid: string
    }
    el.statusid = 'f'
    el.initial = { focused: F2, ancestors: [], descendants: [E2] }
    document.body.appendChild(el)

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    // Find the mount's inner <ul> to navigate to the descendant's <li>.
    const mount = el.shadowRoot!.querySelector('caribou-list-mount') as HTMLElement & { mountUl: HTMLUListElement }
    const liE_before = mount.mountUl.querySelector('caribou-status-card[data-id="e"]')!.parentElement as HTMLLIElement
    const depthBefore = liE_before.dataset.depth
    expect(depthBefore).toBeDefined()

    // Now arrive D, which makes E a real depth-2 descendant of F (F → D → E).
    const D2 = { id: 'd', content: '<p>d</p>', account: ACCT2, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'f' }
    const store = (el as unknown as { store: ThreadStore }).store
    store._testOnlySetDescendants([D2, E2] as Parameters<ThreadStore['_testOnlySetDescendants']>[0])

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const liE_after = mount.mountUl.querySelector('caribou-status-card[data-id="e"]')!.parentElement as HTMLLIElement
    expect(liE_after).toBe(liE_before) // identity preserved
    expect(liE_after.dataset.depth).not.toBe(depthBefore) // depth shifted
  })
})
