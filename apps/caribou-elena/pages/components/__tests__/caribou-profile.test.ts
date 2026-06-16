import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { CaribouListMount } from '../caribou-list-mount.js'

beforeAll(async () => { await import('../caribou-profile.js') })

const ACCOUNT = {
  id: '42', acct: 'alice@example.social', username: 'alice', displayName: 'A',
  avatar: '', avatarStatic: '', note: '', followersCount: 0, followingCount: 0,
  statusesCount: 0, header: '', headerStatic: '',
}
const STATUS = {
  id: '210', content: '<p>x</p>', account: ACCOUNT,
  createdAt: '2026-04-28T12:00:00Z',
}

// Flush microtasks + one macrotask tick (Elena schedules renders with
// queueMicrotask; settled renders are visible after a setTimeout(0) turn).
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('<caribou-profile>', () => {
  it('mounts header + tabs + status list when initial is provided', async () => {
    const el = document.createElement('caribou-profile') as HTMLElement & {
      handle: string; tab: string; initial: unknown
    }
    el.handle = '@alice@example.social'
    el.tab = 'media'
    el.initial = { account: ACCOUNT, statuses: [STATUS], nextMaxId: null, tab: 'media' }
    document.body.appendChild(el)
    await flush()
    await flush()
    expect(el.querySelector('caribou-profile-header')).toBeTruthy()
    expect(el.querySelector('caribou-profile-tabs')).toBeTruthy()
    // Cards are rendered inside <caribou-list-mount>'s shadow-DOM <ul>,
    // which is opaque to el.querySelectorAll. Access via mountUl instead.
    const mount = el.querySelector('caribou-list-mount') as CaribouListMount | null
    expect(mount).toBeTruthy()
    expect(mount!.mountUl.querySelectorAll('caribou-status-card').length).toBe(1)
  })

  it('seeds the list-mount with SSR items carrying variant + data-status-id', async () => {
    const el = document.createElement('caribou-profile') as HTMLElement & {
      handle: string; tab: string; initial: unknown
    }
    el.handle = '@alice@example.social'
    el.tab = 'posts'
    el.initial = { account: ACCOUNT, statuses: [STATUS], nextMaxId: null, tab: 'posts' }
    document.body.appendChild(el)
    await flush()
    await flush()
    // The list-mount must arrive pre-seeded so SSR paints cards on first
    // paint (no empty-list flash). The serialized <li>/card must match the
    // keyed reconciler's create() output exactly to avoid a hydration diff.
    const items = el.querySelector('caribou-list-mount')!.getAttribute('items') ?? ''
    expect(items).toContain('data-key="210"')
    expect(items).toContain('variant="timeline"')
    expect(items).toContain('data-status-id="210"')
  })

  it('passes account to the header via attribute so the header SSR-paints', async () => {
    const el = document.createElement('caribou-profile') as HTMLElement & {
      handle: string; tab: string; initial: unknown
    }
    el.handle = '@alice@example.social'
    el.tab = 'posts'
    el.initial = { account: ACCOUNT, statuses: [STATUS], nextMaxId: null, tab: 'posts' }
    document.body.appendChild(el)
    await flush()
    await flush()
    const header = el.querySelector('caribou-profile-header')!
    expect(header.getAttribute('account')).toContain('"id":"42"')
  })
})

describe('<caribou-profile> — keyed reconciliation', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('does not re-fire header.account setter when account unchanged across tab swap', async () => {
    // Mount a dummy header first to trigger descriptor installation, then we can wrap it
    const headerEl = document.createElement('caribou-profile-header') as HTMLElement & { account?: unknown }
    headerEl.account = ACCOUNT
    document.body.appendChild(headerEl)
    await Promise.resolve()
    // Remove the dummy so profile renders its own
    headerEl.remove()

    // Now wrap the installed descriptor
    const headerProto = customElements.get('caribou-profile-header')?.prototype as unknown as { account?: unknown } | undefined
    const desc = headerProto && Object.getOwnPropertyDescriptor(headerProto, 'account')
    let setterCalls = 0
    const origSet = desc?.set
    if (origSet) {
      Object.defineProperty(headerProto!, 'account', {
        ...desc,
        set(this: unknown, v: unknown) { setterCalls++; origSet.call(this, v) },
      })
    }

    try {
      const profile = document.createElement('caribou-profile') as HTMLElement & {
        handle: string; tab: string; initial: unknown; requestUpdate?: () => void
      }
      profile.handle = 'a@example.test'
      profile.tab = 'posts'
      profile.initial = { account: ACCOUNT, statuses: [STATUS], nextMaxId: null, tab: 'posts' }
      document.body.appendChild(profile)

      // Wait for initial render + first tab data.
      await flush()
      await flush()

      // Reset after mount; mount-time setter fires are expected.
      setterCalls = 0

      // Swap tab — the entire status list should swap, but account is unchanged.
      profile.tab = 'media'
      profile.requestUpdate?.()
      await flush()
      await flush()

      expect(setterCalls).toBe(0)
    } finally {
      if (desc && origSet) Object.defineProperty(headerProto!, 'account', desc)
    }
  })
})
