import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(async () => {
  await import('../caribou-status-card.js')
})

const fixture = (over: Partial<Record<string, unknown>> = {}): unknown => ({
  id: '1',
  content: '<p>hello</p>',
  account: { id: '1', acct: 'a', username: 'a', displayName: 'A', avatar: '', avatarStatic: '' },
  createdAt: '2026-04-28T12:00:00Z',
  ...over,
})

describe('<caribou-status-card> variants', () => {
  it.each(['timeline', 'focused', 'ancestor', 'descendant'] as const)
    ('applies variant=%s on root <article>', async (v) => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: unknown; variant: string }
    el.variant = v
    el.status = fixture()
    document.body.appendChild(el)
    await Promise.resolve()
    const article = el.shadowRoot!.querySelector('article')!
    expect(article.dataset.variant).toBe(v)
  })

  it('focused variant emits an absolute timestamp at first paint', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('caribou-status-card') as HTMLElement & { status: unknown; variant: string }
    el.variant = 'focused'
    el.status = fixture()
    document.body.appendChild(el)
    await Promise.resolve()
    const time = el.shadowRoot!.querySelector('time')!
    expect(time.getAttribute('datetime')).toBe('2026-04-28T12:00:00Z')
    expect(time.textContent).not.toBe('just now')
  })
})
