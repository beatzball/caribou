import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => { await import('../caribou-thread.js') })

const ACCT = { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' }
const A = { id: 'a', content: '<p>a</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: null }
const B = { id: 'b', content: '<p>b</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'a' }
const F = { id: 'f', content: '<p>f</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'b' }
const C = { id: 'c', content: '<p>c</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'f' }
const D = { id: 'd', content: '<p>d</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'c' }
const E = { id: 'e', content: '<p>e</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'd' }
const G = { id: 'g', content: '<p>g</p>', account: ACCT, createdAt: '2026-04-28T12:00:00Z', inReplyToId: 'e' }

describe('<caribou-thread> indent cap at depth 3', () => {
  it('caps depth at 3 for descendants more than 3 levels below focused', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-thread') as HTMLElement & { initial: unknown; statusId: string }
    el.statusId = 'f'
    el.initial = { focused: F, ancestors: [A, B], descendants: [C, D, E, G] }
    document.body.appendChild(el)
    await Promise.resolve()
    const cards = el.shadowRoot!.querySelectorAll('caribou-status-card[data-depth]')
    const depths = Array.from(cards).map((c) => Number((c as HTMLElement).dataset.depth))
    expect(Math.max(...depths)).toBeLessThanOrEqual(3)
  })

  it('renders ancestors (no indent), focused, then descendants (indented)', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-thread') as HTMLElement & { initial: unknown; statusId: string }
    el.statusId = 'f'
    el.initial = { focused: F, ancestors: [A, B], descendants: [C] }
    document.body.appendChild(el)
    await Promise.resolve()
    const cards = el.shadowRoot!.querySelectorAll('caribou-status-card')
    expect(cards.length).toBe(4)
    const variants = Array.from(cards).map((c) => c.getAttribute('variant'))
    expect(variants).toEqual(['ancestor', 'ancestor', 'focused', 'descendant'])
  })
})
