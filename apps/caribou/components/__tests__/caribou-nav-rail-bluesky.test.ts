import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import { activeUserKey, users } from '@beatzball/caribou-state'
import '../caribou-nav-rail.js'
import type { CaribouNavRail } from '../caribou-nav-rail.js'
import { blueskyClients } from './_bluesky-clients.js'
import { blueskyClient, fakeAgent, signInBluesky } from './_bluesky-helpers.js'

// With a Bluesky account active the rail hides Local and Public (the
// network has neither). Search (#192) and Lists (#195) show.

vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  const { blueskyClients: made } = await import('./_bluesky-clients.js')
  return {
    ...real,
    createCaribouClient: (...args: Parameters<typeof real.createCaribouClient>) =>
      (made.get(args[0]) as ReturnType<typeof real.createCaribouClient> | undefined) ?? real.createCaribouClient(...args),
  }
})

async function mount(): Promise<CaribouNavRail> {
  const el = document.createElement('caribou-nav-rail') as CaribouNavRail
  document.body.appendChild(el)
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0))
    while (!(await el.updateComplete)) { /* settle */ }
  }
  return el
}

const hrefs = (el: CaribouNavRail) =>
  [...el.shadowRoot!.querySelectorAll('nav a[href]')].map((a) => a.getAttribute('href'))

beforeEach(() => {
  users.value = new Map()
  activeUserKey.value = null
  blueskyClients.clear()
  localStorage.clear()
})
afterEach(() => { document.body.replaceChildren() })

describe('<caribou-nav-rail> with a Bluesky account', () => {
  it('shows Home, Notifications, Search, Bookmarks, Lists, Settings and Profile; hides Local, Public', async () => {
    signInBluesky(blueskyClient(fakeAgent()))
    const el = await mount()
    const shown = hrefs(el)
    for (const href of ['/home', '/notifications', '/search', '/bookmarks', '/lists', '/settings', '/@me']) expect(shown).toContain(href)
    for (const href of ['/local', '/public']) expect(shown).not.toContain(href)
  })
})
