import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import {
  activeUserKey, lastSeenNotificationId, statusCache, unreadNotificationCount, users,
} from '@beatzball/caribou-state'
import '../caribou-notifications.js'
import type { CaribouNotifications } from '../caribou-notifications.js'

// Every client, also one made by a switch inside a test, asks `fetchSpy`.
vi.mock('@beatzball/caribou-mastodon-client', async (importOriginal) => {
  const real = await importOriginal<typeof ClientModule>()
  return {
    ...real,
    createCaribouClient: (...args: Parameters<typeof real.createCaribouClient>) => ({
      ...real.createCaribouClient(...args),
      fetchNotifications: (...a: unknown[]) => fetchSpy(...a),
    }),
  }
})

type Key = NonNullable<typeof activeUserKey.value>
const userKey = 'alice@example.social' as Key
const bobKey = 'bob@example.social' as Key
const ACCT = { id: 'b1', acct: 'bob', username: 'bob', displayName: 'Bob', avatar: '', avatarStatic: '' }

function status(id: string) {
  return { id, content: `<p>post ${id}</p>`, account: ACCT, createdAt: '2026-05-08T12:00:00Z', inReplyToId: null }
}

function notif(id: string, type: string, withStatus = !['follow', 'follow_request'].includes(type)) {
  return {
    id, type, createdAt: '2026-05-08T12:00:00Z', groupKey: `ungrouped-${id}`, account: ACCT,
    ...(withStatus ? { status: status(`s${id}`) } : {}),
  } as unknown as mastodon.v1.Notification
}

const fetchSpy = vi.fn(async (..._: unknown[]) => [] as mastodon.v1.Notification[])

function signIn(key: Key = userKey) {
  users.value = new Map([...users.value, [key, {
    userKey: key, server: 'example.social', token: 'TOKEN', vapidKey: '', createdAt: 1, account: null,
  }]])
  activeUserKey.value = key
}

let visibility: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
function setVisibility(v: DocumentVisibilityState) {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

async function settle(el: CaribouNotifications) {
  await flush()
  await el.updateComplete
  await flush()
}

const flush = () => new Promise((r) => setTimeout(r, 0))

async function mount(parent: ParentNode = document.body): Promise<CaribouNotifications> {
  const el = document.createElement('caribou-notifications') as CaribouNotifications
  parent.appendChild(el)
  await flush()
  while (!(await el.updateComplete)) { /* until no update is pending */ }
  return el
}

const items = (el: CaribouNotifications) => [...el.shadowRoot!.querySelectorAll('li')]
const lineText = (li: Element) => li.querySelector('.line')?.textContent?.replace(/\s+/g, ' ').trim()

beforeEach(() => {
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue([])
  visibility = 'visible'
  users.value = new Map()
  localStorage.clear()
  statusCache.value = new Map()
  unreadNotificationCount.value = 0
  signIn()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('caribou-notifications', () => {
  it('renders one row per type, with a card for the ones about a post', async () => {
    fetchSpy.mockResolvedValueOnce([
      notif('8', 'mention'), notif('7', 'favourite'), notif('6', 'reblog'), notif('5', 'follow'),
      notif('4', 'follow_request'), notif('3', 'poll'), notif('2', 'update'), notif('1', 'status'),
    ])
    const el = await mount()
    const rows = items(el)
    expect(rows.map((li) => li.className.split(' ')[0])).toEqual([
      'n-mention', 'n-favourite', 'n-reblog', 'n-follow', 'n-follow_request', 'n-poll', 'n-update', 'n-status',
    ])
    expect(rows[0]!.querySelector('.line')).toBeNull()
    expect(rows[0]!.querySelector('caribou-status-card')).not.toBeNull()
    expect(lineText(rows[1]!)).toBe('Bob favourited your post')
    expect(lineText(rows[2]!)).toBe('Bob boosted your post')
    expect(lineText(rows[3]!)).toBe('Bob followed you')
    expect(rows[3]!.querySelector('caribou-status-card')).toBeNull()
    expect(lineText(rows[4]!)).toBe('Bob asked to follow you')
    expect(lineText(rows[5]!)).toBe('Bob ran a poll that has ended')
    expect(lineText(rows[6]!)).toBe('Bob edited a post you interacted with')
    expect(rows[1]!.querySelector('caribou-status-card')?.getAttribute('instance')).toBe('example.social')
    // A local account's profile link gets the user's server.
    expect(rows[1]!.querySelector('.line a')?.getAttribute('href')).toBe('/@bob@example.social')
  })

  it('renders a generic line for a type it does not know, and survives missing fields', async () => {
    fetchSpy.mockResolvedValueOnce([
      notif('2', 'admin.sign_up', false),
      { id: '1', type: 'something_new' } as unknown as mastodon.v1.Notification,
    ])
    const el = await mount()
    const rows = items(el)
    expect(lineText(rows[0]!)).toBe('Bob sent you a notification')
    expect(rows[0]!.className).toBe('n-adminsign_up no-status')
    expect(lineText(rows[1]!)).toBe('New notification')
  })

  it('marks the newest one seen once the list is shown', async () => {
    fetchSpy.mockResolvedValueOnce([notif('9', 'mention'), notif('8', 'follow')])
    unreadNotificationCount.value = 2
    await mount()
    expect(lastSeenNotificationId(userKey)).toBe('9')
    expect(unreadNotificationCount.value).toBe(0)
  })

  it('the Mentions filter asks for types[]=mention and does not move the marker', async () => {
    const el = await mount()
    expect(fetchSpy).toHaveBeenLastCalledWith({ types: [] })
    const [all, mentions] = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.filters button')]
    expect(all!.getAttribute('aria-pressed')).toBe('true')
    expect(mentions!.getAttribute('aria-pressed')).toBe('false')

    fetchSpy.mockResolvedValueOnce([notif('20', 'mention')])
    mentions!.click()
    await flush()
    await el.updateComplete
    expect(fetchSpy).toHaveBeenLastCalledWith({ types: ['mention'] })
    expect(mentions!.getAttribute('aria-pressed')).toBe('true')
    expect(items(el)).toHaveLength(1)
    expect(lastSeenNotificationId(userKey)).toBeNull()
  })

  it('shows an empty state per filter', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('.notice')?.textContent).toBe('No notifications yet.')
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-filter="mentions"]')!.click()
    await flush()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('.notice')?.textContent).toBe('No mentions yet.')
  })

  it('shows an error with Retry, which loads again and marks seen', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('server is down'))
    const el = await mount()
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain('server is down')
    fetchSpy.mockResolvedValueOnce([notif('1', 'follow')])
    el.shadowRoot!.querySelector<HTMLElement>('[role="alert"] caribou-button')!.click()
    await settle(el)
    expect(items(el)).toHaveLength(1)
    expect(lastSeenNotificationId(userKey)).toBe('1')
  })

  it('a failed poll keeps the rows and shows the error beside them, until a poll works', async () => {
    fetchSpy.mockResolvedValueOnce([notif('1', 'follow')])
    const el = await mount()
    fetchSpy.mockRejectedValueOnce(new Error('blip'))
    setVisibility('visible')
    await settle(el)
    expect(items(el)).toHaveLength(1)
    expect(el.shadowRoot!.querySelector('.inline-error')?.textContent).toBe('blip')

    fetchSpy.mockResolvedValueOnce([notif('2', 'follow')])
    setVisibility('visible')
    await settle(el)
    expect(items(el)).toHaveLength(2)
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull()
  })

  it('does not mark seen in a hidden tab, and marks seen when the tab is shown', async () => {
    visibility = 'hidden'
    fetchSpy.mockResolvedValueOnce([notif('9', 'follow')])
    const el = await mount()
    expect(items(el)).toHaveLength(1)
    expect(lastSeenNotificationId(userKey)).toBeNull()
    setVisibility('visible')
    await settle(el)
    expect(lastSeenNotificationId(userKey)).toBe('9')
  })

  // The router's next page: added with `hidden`, inside the page's shadow root.
  function hiddenPage() {
    const page = document.createElement('div')
    page.setAttribute('hidden', '')
    document.body.appendChild(page)
    return { page, root: page.attachShadow({ mode: 'open' }) }
  }

  it('in a page the router has not shown yet, marks seen only once the page is shown', async () => {
    fetchSpy.mockResolvedValueOnce([notif('9', 'follow')])
    unreadNotificationCount.value = 1
    const { page, root } = hiddenPage()
    const el = await mount(root)
    await settle(el)
    expect(items(el)).toHaveLength(1)
    expect(lastSeenNotificationId(userKey)).toBeNull()
    expect(unreadNotificationCount.value).toBe(1)

    page.removeAttribute('hidden')
    await settle(el)
    expect(lastSeenNotificationId(userKey)).toBe('9')
    expect(unreadNotificationCount.value).toBe(0)
  })

  it('a hidden page that the router removes never marks seen', async () => {
    fetchSpy.mockResolvedValueOnce([notif('9', 'follow')])
    const { page, root } = hiddenPage()
    const el = await mount(root)
    await settle(el)
    page.remove()
    page.removeAttribute('hidden')
    await settle(el)
    expect(lastSeenNotificationId(userKey)).toBeNull()
  })

  it('a reply for the old session is dropped, and the list starts again for the new one', async () => {
    let resolve!: (v: mastodon.v1.Notification[]) => void
    fetchSpy.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const el = await mount()
    fetchSpy.mockResolvedValueOnce([notif('3', 'follow')])
    signIn(bobKey)
    await settle(el)
    resolve([notif('900', 'follow')])
    await settle(el)
    expect(items(el).map((li) => li.className)).toEqual(['n-follow no-status'])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(lastSeenNotificationId(bobKey)).toBe('3')
    expect(lastSeenNotificationId(userKey)).toBeNull()
  })

  it('polls when the app-wide unread count goes up', async () => {
    fetchSpy.mockResolvedValueOnce([notif('1', 'follow')])
    const el = await mount()
    fetchSpy.mockResolvedValueOnce([notif('2', 'follow')])
    unreadNotificationCount.value = 1
    await settle(el)
    expect(fetchSpy).toHaveBeenLastCalledWith({ types: [], minId: '1', limit: 40 })
    expect(items(el)).toHaveLength(2)
    expect(unreadNotificationCount.value).toBe(0)
  })

  it('a failed poll does not clear the unread count', async () => {
    fetchSpy.mockResolvedValueOnce([notif('1', 'follow')])
    const el = await mount()
    fetchSpy.mockRejectedValueOnce(new Error('blip'))
    unreadNotificationCount.value = 3
    await settle(el)
    expect(el.shadowRoot!.querySelector('.inline-error')?.textContent).toBe('blip')
    expect(unreadNotificationCount.value).toBe(3)
    expect(lastSeenNotificationId(userKey)).toBe('1')
  })

  it('a count that comes in during a load polls once the load ends', async () => {
    let resolve!: (v: mastodon.v1.Notification[]) => void
    fetchSpy.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const el = await mount()
    unreadNotificationCount.value = 2
    expect(fetchSpy).toHaveBeenCalledOnce()
    fetchSpy.mockResolvedValueOnce([notif('3', 'follow')])
    resolve([notif('2', 'follow')])
    await settle(el)
    expect(fetchSpy).toHaveBeenLastCalledWith({ types: [], minId: '2', limit: 40 })
    expect(items(el)).toHaveLength(2)
    expect(unreadNotificationCount.value).toBe(0)
  })

  it('a mention without its post gets the generic line', async () => {
    fetchSpy.mockResolvedValueOnce([notif('1', 'mention', false)])
    const el = await mount()
    expect(lineText(items(el)[0]!)).toBe('Bob sent you a notification')
  })

  it('Load older pages with max_id', async () => {
    fetchSpy.mockResolvedValueOnce([notif('5', 'follow')])
    const el = await mount()
    fetchSpy.mockResolvedValueOnce([notif('4', 'follow')])
    el.shadowRoot!.querySelector<HTMLElement>('.more caribou-button')!.click()
    await flush()
    await el.updateComplete
    expect(fetchSpy).toHaveBeenLastCalledWith({ types: [], maxId: '5' })
    expect(items(el)).toHaveLength(2)
  })
})
