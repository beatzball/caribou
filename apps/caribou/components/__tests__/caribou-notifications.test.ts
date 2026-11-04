import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { mastodon } from 'masto'
import type * as ClientModule from '@beatzball/caribou-mastodon-client'
import { CaribouError, type GroupedNotificationsPage } from '@beatzball/caribou-mastodon-client'
import {
  activeUserKey, lastSeenNotificationId, resetGroupedSupport, relationshipCache, relationshipKey, statusCache, unreadNotificationCount, users,
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
      fetchGroupedNotifications: (...a: unknown[]) => groupedSpy(...a),
      fetchNotificationGroupAccounts: (...a: unknown[]) => accountsSpy(...a),
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
    id, type, createdAt: '2026-05-08T12:00:00Z', account: ACCT,
    ...(withStatus ? { status: status(`s${id}`) } : {}),
  } as unknown as mastodon.v1.Notification
}

const fetchSpy = vi.fn(async (..._: unknown[]) => [] as mastodon.v1.Notification[])
const accountsSpy = vi.fn(async (..._: unknown[]) => [] as mastodon.v1.Account[])
// By default the server is older than Mastodon 4.3: no grouped endpoint.
const olderServer = async (..._: unknown[]): Promise<GroupedNotificationsPage> => {
  throw new CaribouError('not_found', 'Not found')
}
const groupedSpy = vi.fn(olderServer)

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

const items = (el: CaribouNotifications) => [...el.shadowRoot!.querySelectorAll('ul.rows > li')]
const lineText = (li: Element) => li.querySelector('.line > span')?.textContent?.replace(/\s+/g, ' ').trim()

beforeEach(() => {
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue([])
  groupedSpy.mockReset()
  groupedSpy.mockImplementation(olderServer)
  accountsSpy.mockReset()
  relationshipCache.value = new Map()
  accountsSpy.mockResolvedValue([])
  resetGroupedSupport()
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
    // Shared toggles: the inner button carries aria-pressed.
    const [all, mentions] = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.filters caribou-button')]
    const pressed = (b: HTMLElement) => b.shadowRoot!.querySelector('button')!.getAttribute('aria-pressed')
    await (mentions as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete
    expect(all!.textContent).toBe('All')
    expect(mentions!.textContent).toBe('Mentions')
    expect(pressed(all!)).toBe('true')
    expect(pressed(mentions!)).toBe('false')

    fetchSpy.mockResolvedValueOnce([notif('20', 'mention')])
    mentions!.click()
    await flush()
    await el.updateComplete
    expect(fetchSpy).toHaveBeenLastCalledWith({ types: ['mention'] })
    await (mentions as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete
    expect(pressed(mentions!)).toBe('true')
    expect(pressed(all!)).toBe('false')
    expect(items(el)).toHaveLength(1)
    expect(lastSeenNotificationId(userKey)).toBeNull()
  })

  it('shows an empty state per filter', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('.notice')?.textContent).toBe('No notifications yet.')
    el.shadowRoot!.querySelector<HTMLElement>('caribou-button[data-filter="mentions"]')!.click()
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
    fetchSpy.mockResolvedValueOnce([notif('1', 'mention')])
    const el = await mount()
    fetchSpy.mockRejectedValueOnce(new Error('blip'))
    setVisibility('visible')
    await settle(el)
    expect(items(el)).toHaveLength(1)
    expect(el.shadowRoot!.querySelector('.inline-error')?.textContent).toBe('blip')

    fetchSpy.mockResolvedValueOnce([notif('2', 'mention')])
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
    fetchSpy.mockResolvedValueOnce([notif('1', 'mention')])
    const el = await mount()
    fetchSpy.mockResolvedValueOnce([notif('2', 'mention')])
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
    fetchSpy.mockResolvedValueOnce([notif('3', 'mention')])
    resolve([notif('2', 'mention')])
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
    fetchSpy.mockResolvedValueOnce([notif('5', 'mention')])
    const el = await mount()
    fetchSpy.mockResolvedValueOnce([notif('4', 'mention')])
    el.shadowRoot!.querySelector<HTMLElement>('.more caribou-button')!.click()
    await flush()
    await el.updateComplete
    expect(fetchSpy).toHaveBeenLastCalledWith({ types: [], maxId: '5' })
    expect(items(el)).toHaveLength(2)
  })

  // Mastodon hides a muted or blocked account's notifications; the rows
  // already loaded go the moment the reader mutes, as the card's own do.
  it('drops the rows of an account the reader mutes or blocks, with or without a post, and brings them back', async () => {
    relationshipCache.value = new Map()
    const carol = { ...ACCT, id: 'c1', acct: 'carol', username: 'carol', displayName: 'Carol' }
    // A favourite of the reader's own post: the post's author is the reader.
    const mine = { ...status('s9'), account: { ...ACCT, id: 'me', acct: 'alice' } }
    fetchSpy.mockResolvedValueOnce([
      { ...notif('9', 'favourite'), status: mine },
      notif('8', 'follow'),
      { ...notif('7', 'follow'), account: carol },
    ] as unknown as mastodon.v1.Notification[])
    const el = await mount()
    expect(items(el)).toHaveLength(2)
    expect(lineText(items(el)[1]!)).toBe('Bob and Carol followed you')
    relationshipCache.value = new Map([[relationshipKey(userKey, 'b1'), { id: 'b1', muting: true } as mastodon.v1.Relationship]])
    await el.updateComplete
    expect(items(el).map((li) => li.className.split(' ')[0])).toEqual(['n-follow'])
    expect(lineText(items(el)[0]!)).toBe('Carol followed you')
    relationshipCache.value = new Map([[relationshipKey(userKey, 'b1'), { id: 'b1', blocking: true } as mastodon.v1.Relationship]])
    await el.updateComplete
    expect(items(el)).toHaveLength(1)
    relationshipCache.value = new Map()
    await el.updateComplete
    expect(items(el)).toHaveLength(2)
  })

  it('does not drop rows for another account\'s mutes', async () => {
    relationshipCache.value = new Map([[relationshipKey(bobKey, 'b1'), { id: 'b1', muting: true } as mastodon.v1.Relationship]])
    fetchSpy.mockResolvedValueOnce([notif('8', 'follow')])
    const el = await mount()
    expect(items(el)).toHaveLength(1)
    relationshipCache.value = new Map()
  })

  describe('grouped', () => {
    const person = (id: string, name: string) => ({ ...ACCT, id, acct: name.toLowerCase(), username: name.toLowerCase(), displayName: name, avatar: `https://example.social/${id}.png` })
    const alice = person('a1', 'Alice')
    const carol = person('c1', 'Carol')

    function groupedPage(): GroupedNotificationsPage {
      return {
        accounts: [alice, ACCT, carol] as unknown as mastodon.v1.Account[],
        statuses: [status('s1')] as unknown as mastodon.v1.Status[],
        notificationGroups: [
          { groupKey: 'favourite-s1-1', type: 'favourite', notificationsCount: 14, mostRecentNotificationId: '30',
            pageMinId: '10', pageMaxId: '30', sampleAccountIds: ['a1', 'b1'], statusId: 's1' },
          { groupKey: 'ungrouped-9', type: 'mention', notificationsCount: 1, mostRecentNotificationId: '9',
            pageMinId: '9', pageMaxId: '9', sampleAccountIds: ['c1'], statusId: 's1' },
          { groupKey: 'follow-1', type: 'follow', notificationsCount: 2, mostRecentNotificationId: '8',
            pageMinId: '7', pageMaxId: '8', sampleAccountIds: ['c1', 'a1'] },
        ],
      }
    }

    it('shows the server\'s groups: names, a count of the others, and an avatar stack', async () => {
      groupedSpy.mockResolvedValueOnce(groupedPage())
      const el = await mount()
      expect(fetchSpy).not.toHaveBeenCalled()
      const rows = items(el)
      expect(rows.map((li) => li.className.split(' ')[0])).toEqual(['n-favourite', 'n-mention', 'n-follow'])
      expect(lineText(rows[0]!)).toContain('Alice, Bob and 12 others favourited your post')
      expect(rows[0]!.querySelectorAll('.avatars img')).toHaveLength(2)
      expect(rows[0]!.querySelector('caribou-status-card')).not.toBeNull()
      expect(lineText(rows[2]!)).toContain('Carol and Alice followed you')
      expect(lastSeenNotificationId(userKey)).toBe('30')
    })

    const dave = person('d1', 'Dave')
    // Everyone in the count-14 favourite group.
    const fourteen = () => [alice, ACCT, carol, ...Array.from({ length: 11 }, (_, i) => person(`f${i}`, `Fan${i}`))]
    const toggleOf = (el: CaribouNotifications, i = 0) => items(el)[i]!.querySelector<HTMLButtonElement>('button.expand')!
    const names = (el: CaribouNotifications, i = 0) =>
      [...items(el)[i]!.querySelectorAll('.who li a')].map((a) => a.textContent?.trim())

    it('a poll that adds someone to a group loads its list again, open or closed', async () => {
      groupedSpy.mockResolvedValueOnce(groupedPage())
      accountsSpy.mockResolvedValueOnce(fourteen() as unknown as mastodon.v1.Account[])
      const el = await mount()
      toggleOf(el).click()
      await settle(el)
      expect(names(el)).toHaveLength(14)
      // Dave favourites too: the server's total for the group is now 15.
      const newer = groupedPage()
      newer.notificationGroups = [{ ...newer.notificationGroups[0]!, notificationsCount: 15,
        mostRecentNotificationId: '31', pageMinId: '31', pageMaxId: '31', sampleAccountIds: ['d1', 'a1'] }]
      newer.accounts = [dave, alice] as unknown as mastodon.v1.Account[]
      groupedSpy.mockResolvedValueOnce(newer)
      accountsSpy.mockResolvedValueOnce([dave, ...fourteen()] as unknown as mastodon.v1.Account[])
      unreadNotificationCount.value = 1
      await settle(el)
      await settle(el)
      expect(lineText(items(el)[0]!)).toBe('Dave, Alice and 13 others favourited your post')
      // Open: it loads again at once and lists Dave.
      expect(accountsSpy).toHaveBeenCalledTimes(2)
      expect(names(el)).toContain('Dave')
      expect(items(el)[0]!.querySelector('.who')?.textContent).not.toContain('more')
      // Closed, then opened after another poll: it loads again too.
      toggleOf(el).click()
      await el.updateComplete
      const later = groupedPage()
      later.notificationGroups = [{ ...newer.notificationGroups[0]!, notificationsCount: 16,
        mostRecentNotificationId: '32', pageMinId: '32', pageMaxId: '32', sampleAccountIds: ['b1', 'd1'] }]
      groupedSpy.mockResolvedValueOnce(later)
      unreadNotificationCount.value = 1
      await settle(el)
      accountsSpy.mockResolvedValueOnce([dave, ...fourteen()] as unknown as mastodon.v1.Account[])
      toggleOf(el).click()
      await settle(el)
      expect(accountsSpy).toHaveBeenCalledTimes(3)
    })

    it.each(['answer', 'failure'])('a list %s from before A -> B -> A changes nothing', async (kind) => {
      groupedSpy.mockResolvedValue(groupedPage())
      let release!: () => void
      accountsSpy.mockReturnValueOnce(new Promise((resolve, reject) => {
        release = () => kind === 'answer'
          ? resolve([person('z1', 'Stale')] as unknown as mastodon.v1.Account[])
          : reject(new Error('stale'))
      }))
      const el = await mount()
      toggleOf(el).click()
      await el.updateComplete
      signIn(bobKey)
      await settle(el)
      signIn(userKey)
      await settle(el)
      accountsSpy.mockResolvedValueOnce(fourteen() as unknown as mastodon.v1.Account[])
      toggleOf(el).click()
      await settle(el)
      expect(names(el)).toHaveLength(14)
      release()
      await settle(el)
      expect(names(el)).toEqual(fourteen().map((a) => a.displayName))
      expect(items(el)[0]!.querySelector('.who [role="alert"]')).toBeNull()
      expect(items(el)[0]!.querySelector('.who [role="status"]')).toBeNull()
    })

    it('a row left with one unnamed person can still show who it is', async () => {
      relationshipCache.value = new Map([
        [relationshipKey(userKey, 'a1'), { id: 'a1', muting: true } as mastodon.v1.Relationship],
        [relationshipKey(userKey, 'b1'), { id: 'b1', blocking: true } as mastodon.v1.Relationship],
      ])
      groupedSpy.mockResolvedValueOnce({
        accounts: [alice, ACCT] as unknown as mastodon.v1.Account[],
        statuses: [],
        notificationGroups: [{ groupKey: 'follow-9', type: 'follow', notificationsCount: 3,
          mostRecentNotificationId: '9', pageMinId: '7', pageMaxId: '9', sampleAccountIds: ['a1', 'b1'] }],
      })
      accountsSpy.mockResolvedValueOnce([alice, ACCT, carol] as unknown as mastodon.v1.Account[])
      const el = await mount()
      expect(lineText(items(el)[0]!)).toBe('Someone followed you')
      toggleOf(el).click()
      await settle(el)
      expect(names(el)).toEqual(['Carol'])
      relationshipCache.value = new Map()
    })
    const shadow = (el: CaribouNotifications) => el.shadowRoot!

    it('Show all loads everyone in a server group, keeps focus on the button, and Hide closes it', async () => {
      groupedSpy.mockResolvedValueOnce(groupedPage())
      let resolve!: (a: mastodon.v1.Account[]) => void
      accountsSpy.mockReturnValueOnce(new Promise((r) => { resolve = r }))
      const el = await mount()
      const toggle = () => items(el)[0]!.querySelector<HTMLButtonElement>('button.expand')!
      expect(toggle().getAttribute('aria-label')).toBe('Show all 14 who favourited your post')
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
      // Nothing to point at while closed.
      expect(toggle().hasAttribute('aria-controls')).toBe(false)
      toggle().focus()
      toggle().click()
      await el.updateComplete
      expect(accountsSpy).toHaveBeenCalledWith('favourite-s1-1')
      expect(items(el)[0]!.querySelector('.who')?.textContent).toContain('Loading')
      resolve(fourteen() as unknown as mastodon.v1.Account[])
      await settle(el)
      const who = items(el)[0]!.querySelector('.who')!
      expect([...who.querySelectorAll('li a')].map((a) => a.textContent?.trim())).toEqual(fourteen().map((a) => a.displayName))
      expect(who.textContent).not.toContain('more')
      expect(toggle().getAttribute('aria-expanded')).toBe('true')
      expect(toggle().getAttribute('aria-controls')).toBe(who.id)
      expect(toggle().getAttribute('aria-label')).toBe('Hide who favourited your post')
      expect(shadow(el).activeElement).toBe(toggle())
      toggle().click()
      await el.updateComplete
      expect(items(el)[0]!.querySelector('.who')).toBeNull()
      // A second open uses what it loaded.
      toggle().click()
      await el.updateComplete
      expect(accountsSpy).toHaveBeenCalledOnce()
      // A single row has nothing to expand.
      expect(items(el)[1]!.querySelector('button.expand')).toBeNull()
    })

    it('a failed load keeps the sample, says so, and the next open tries again', async () => {
      groupedSpy.mockResolvedValueOnce(groupedPage())
      accountsSpy.mockRejectedValueOnce(new Error('down'))
      const el = await mount()
      const toggle = () => items(el)[0]!.querySelector<HTMLButtonElement>('button.expand')!
      toggle().click()
      await settle(el)
      const who = items(el)[0]!.querySelector('.who')!
      expect([...who.querySelectorAll('li a')].map((a) => a.textContent?.trim())).toEqual(['Alice', 'Bob'])
      expect(who.textContent).toContain('and 12 more')
      expect(who.querySelector('[role="alert"]')?.textContent).toContain('Could not load everyone')
      toggle().click()
      await el.updateComplete
      accountsSpy.mockResolvedValueOnce([alice, ACCT] as unknown as mastodon.v1.Account[])
      toggle().click()
      await settle(el)
      expect(accountsSpy).toHaveBeenCalledTimes(2)
    })

    it('a full list loaded for one account is dropped when the account changes', async () => {
      groupedSpy.mockResolvedValueOnce(groupedPage())
      let resolve!: (a: mastodon.v1.Account[]) => void
      accountsSpy.mockReturnValueOnce(new Promise((r) => { resolve = r }))
      const el = await mount()
      items(el)[0]!.querySelector<HTMLButtonElement>('button.expand')!.click()
      await el.updateComplete
      groupedSpy.mockResolvedValueOnce(groupedPage())
      signIn(bobKey)
      await settle(el)
      resolve([dave] as unknown as mastodon.v1.Account[])
      await settle(el)
      // The new account's row starts closed, with nothing from the old one.
      const toggle = items(el)[0]!.querySelector<HTMLButtonElement>('button.expand')!
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(items(el)[0]!.querySelector('.who')).toBeNull()
      accountsSpy.mockResolvedValueOnce([alice] as unknown as mastodon.v1.Account[])
      toggle.click()
      await settle(el)
      expect(accountsSpy).toHaveBeenCalledTimes(2)
    })

    it('a group with everyone listed does not ask the server', async () => {
      fetchSpy.mockResolvedValueOnce([
        { ...notif('3', 'reblog'), status: status('s1'), account: carol },
        { ...notif('2', 'reblog'), status: status('s1') },
      ] as unknown as mastodon.v1.Notification[])
      const el = await mount()
      items(el)[0]!.querySelector<HTMLButtonElement>('button.expand')!.click()
      await el.updateComplete
      expect(accountsSpy).not.toHaveBeenCalled()
      expect([...items(el)[0]!.querySelectorAll('.who li a')].map((a) => a.textContent?.trim())).toEqual(['Carol', 'Bob'])
    })

    it('a group whose names are all muted still counts the people outside the sample', async () => {
      relationshipCache.value = new Map()
      groupedSpy.mockResolvedValueOnce(groupedPage())
      const el = await mount()
      relationshipCache.value = new Map([
        [relationshipKey(userKey, 'a1'), { id: 'a1', muting: true } as mastodon.v1.Relationship],
        [relationshipKey(userKey, 'b1'), { id: 'b1', blocking: true } as mastodon.v1.Relationship],
      ])
      await el.updateComplete
      expect(lineText(items(el)[0]!)).toBe('12 people favourited your post')
      relationshipCache.value = new Map()
    })

    it('groups single notifications itself on an older server', async () => {
      fetchSpy.mockResolvedValueOnce([
        { ...notif('3', 'reblog'), status: status('s1'), account: carol },
        { ...notif('2', 'reblog'), status: status('s1') },
        notif('1', 'mention'),
      ] as unknown as mastodon.v1.Notification[])
      const el = await mount()
      expect(groupedSpy).toHaveBeenCalledOnce()
      const rows = items(el)
      expect(rows).toHaveLength(2)
      expect(lineText(rows[0]!)).toContain('Carol and Bob boosted your post')
    })

    it('a muted account leaves its group, and a group of only muted accounts goes', async () => {
      relationshipCache.value = new Map()
      groupedSpy.mockResolvedValueOnce(groupedPage())
      const el = await mount()
      relationshipCache.value = new Map([
        [relationshipKey(userKey, 'a1'), { id: 'a1', muting: true } as mastodon.v1.Relationship],
        [relationshipKey(userKey, 'c1'), { id: 'c1', blocking: true } as mastodon.v1.Relationship],
      ])
      await el.updateComplete
      const rows = items(el)
      expect(rows.map((li) => li.className.split(' ')[0])).toEqual(['n-favourite'])
      expect(lineText(rows[0]!)).toContain('Bob and 12 others favourited your post')
      relationshipCache.value = new Map()
    })
  })
})
