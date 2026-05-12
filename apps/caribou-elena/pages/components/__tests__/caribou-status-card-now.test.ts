import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

beforeAll(async () => { await import('../caribou-status-card.js') })

const ACCT = { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' }
const mkStatus = (id: string, createdAt: string) => ({
  id,
  content: `<p>${id}</p>`,
  account: ACCT,
  createdAt,
  inReplyToId: null,
})

describe('<caribou-status-card> — now-resolution', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('uses dataset.renderedAt for the first render after connect', async () => {
    const card = document.createElement('caribou-status-card') as HTMLElement & { status?: unknown }
    card.dataset.renderedAt = '1700000300000' // 2023-11-14T22:18:20.000Z
    document.body.appendChild(card)
    card.status = mkStatus('a', '2023-11-14T22:13:20.000Z') // 5 minutes earlier
    await new Promise((r) => setTimeout(r, 0))
    const text = card.shadowRoot?.textContent ?? ''
    expect(text).toMatch(/5\s*m|5\s*min|5 minutes/i)
  })

  it('switches to Date.now() on subsequent renders', async () => {
    const card = document.createElement('caribou-status-card') as HTMLElement & { status?: unknown }
    card.dataset.renderedAt = '1700000300000'
    document.body.appendChild(card)
    card.status = mkStatus('a', '2023-11-14T22:13:20.000Z')
    await new Promise((r) => setTimeout(r, 0))
    // Re-assign status — triggers a new render. Now we expect Date.now()
    // to dominate (the date is years in the past, so result will be "y" / "years").
    card.status = mkStatus('a', '2023-11-14T22:13:20.000Z')
    await new Promise((r) => setTimeout(r, 0))
    const text = card.shadowRoot?.textContent ?? ''
    // The status hasn't moved but "now" is real Date.now() (2026+), so
    // the relative-time string should reflect a much larger gap.
    expect(text).not.toMatch(/5\s*m|5\s*min|5 minutes/i)
  })
})
