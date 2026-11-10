import { describe, expect, it, vi } from 'vitest'

// The signed-out placeholders on /lists and /lists/<id> name no network:
// Bluesky readers reach these routes too (#195).

vi.mock('../../server/lib/resolve-instance.js', () => ({ resolveInstanceForRoute: vi.fn() }))
vi.mock('../../server/lib/storage.js', () => ({ getStorage: () => ({ getItem: async () => null }) }))

async function label(tag: string, data: unknown): Promise<string> {
  const el = document.createElement(tag) as HTMLElement & { serverData: unknown; updateComplete: Promise<boolean> }
  el.serverData = data
  document.body.appendChild(el)
  while (!(await el.updateComplete)) { /* settle */ }
  const text = el.shadowRoot!.querySelector('caribou-auth-required')!.getAttribute('label')!
  el.remove()
  return text
}

describe('list placeholders', () => {
  it('say what the page needs without naming Mastodon', async () => {
    localStorage.clear()
    await import('../../pages/lists/index.js')
    await import('../../pages/lists/[id].js')
    const shell = { instance: null }
    const index = await label('page-lists', { kind: 'auth-required', shell })
    const one = await label('page-lists-id', { kind: 'auth-required', shell, id: '1' })
    for (const text of [index, one]) {
      expect(text).not.toMatch(/Mastodon/)
      expect(text).toContain('sign in')
    }
  })
})
