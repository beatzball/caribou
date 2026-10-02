import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Signal } from '@preact/signals-core'
import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, addUserSession, cacheStatus, users,
  type ProfileStore, type UserSession,
} from '@beatzball/caribou-state'
import '../caribou-profile.js'
import type { CaribouProfile, ProfileInitial } from '../caribou-profile.js'
import type { CaribouProfileHeader } from '../caribou-profile-header.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'

const ACCOUNT = {
  id: '42', acct: 'alice@example.social', username: 'alice', displayName: 'A',
  avatar: '', avatarStatic: '', note: '', followersCount: 0, followingCount: 0,
  statusesCount: 0, header: '', headerStatic: '',
} as unknown as Account

function status(id: string): Status {
  return {
    id, content: `<p>post ${id}</p>`, account: ACCOUNT, createdAt: '2026-04-28T12:00:00Z',
  } as unknown as Status
}
const STATUS = status('210')

function initialOf(statuses: Status[], nextMaxId: string | null = null): ProfileInitial {
  return { account: ACCOUNT, statuses, nextMaxId, tab: 'posts' }
}

// One macrotask: lets the store's async work and the renders it causes finish.
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

async function mount(props: Partial<Pick<CaribouProfile, 'handle' | 'tab' | 'initial'>>): Promise<CaribouProfile> {
  const el = document.createElement('caribou-profile') as CaribouProfile
  el.handle = props.handle ?? 'alice@example.social'
  if (props.tab) el.tab = props.tab
  if (props.initial) el.initial = props.initial
  document.body.appendChild(el)
  await flush()
  await el.updateComplete
  return el
}

function cards(el: CaribouProfile): CaribouStatusCard[] {
  return [...el.shadowRoot!.querySelectorAll<CaribouStatusCard>('ul > li > caribou-status-card')]
}

function signIn(): NonNullable<typeof activeClient.value> {
  addUserSession({
    userKey: 'alice@example.social', server: 'example.social', token: 'TOKEN',
    vapidKey: '', account: ACCOUNT, createdAt: 1,
  } as unknown as UserSession)
  return activeClient.value!
}

afterEach(() => {
  document.body.replaceChildren()
  activeUserKey.value = null
  users.value = new Map()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('<caribou-profile>', () => {
  it('mounts header + tabs + status list when initial is provided', async () => {
    const el = await mount({ tab: 'media', initial: { ...initialOf([STATUS]), tab: 'media' } })
    const root = el.shadowRoot!
    expect(root.querySelector('caribou-profile-header')).toBeTruthy()
    const tabs = root.querySelector('caribou-profile-tabs')!
    expect(tabs.getAttribute('handle')).toBe('alice@example.social')
    expect(tabs.getAttribute('tab')).toBe('media')
    expect(cards(el).length).toBe(1)
    expect(root.querySelector('.loading')).toBeNull()
  })

  it('renders each card as a timeline card that carries its status id and status', async () => {
    const el = await mount({ initial: initialOf([STATUS, status('209')]) })
    const [first, second] = cards(el)
    expect(first!.getAttribute('variant')).toBe('timeline')
    expect(first!.dataset.statusId).toBe('210')
    expect(first!.status).toBe(STATUS)
    expect(second!.dataset.statusId).toBe('209')
  })

  it('passes the account object to the header', async () => {
    const el = await mount({ initial: initialOf([STATUS]) })
    const header = el.shadowRoot!.querySelector<CaribouProfileHeader>('caribou-profile-header')!
    expect(header.account).toBe(ACCOUNT)
    expect(header.hasAttribute('account')).toBe(false)
  })

  it('renders the header and tabs over an empty list when the account has no posts', async () => {
    const el = await mount({ initial: initialOf([]) })
    expect(el.shadowRoot!.querySelector('caribou-profile-header')).toBeTruthy()
    expect(cards(el).length).toBe(0)
    expect(el.shadowRoot!.querySelector('a[rel="next"]')).toBeNull()
  })

  it('shows Loading… while it has no account', async () => {
    const el = await mount({})
    expect(el.shadowRoot!.querySelector('.loading')?.textContent).toBe('Loading…')
    expect(el.shadowRoot!.querySelector('caribou-profile-header')).toBeNull()
  })

  it('reflects handle and tab to attributes', async () => {
    const el = await mount({ tab: 'replies', initial: initialOf([]) })
    expect(el.getAttribute('handle')).toBe('alice@example.social')
    expect(el.getAttribute('tab')).toBe('replies')
  })
})

describe('<caribou-profile> — without initial (own profile)', () => {
  it('looks the account up through the signed-in client and loads the first page', async () => {
    const client = signIn()
    const lookup = vi.spyOn(client, 'lookupAccount').mockResolvedValue(ACCOUNT)
    const list = vi.spyOn(client, 'fetchAccountStatuses').mockResolvedValue([status('5'), status('4')])
    const el = await mount({ handle: '@alice@example.social', tab: 'replies' })
    await flush()
    await el.updateComplete
    expect(lookup).toHaveBeenCalledWith('alice@example.social')
    expect(list).toHaveBeenCalledWith('42', { tab: 'replies', maxId: undefined })
    expect(cards(el).map((c) => c.dataset.statusId)).toEqual(['5', '4'])
    expect(el.shadowRoot!.querySelector<CaribouProfileHeader>('caribou-profile-header')!.account).toBe(ACCOUNT)
  })

  it('does not fetch when the server already sent the first page', async () => {
    const client = signIn()
    const lookup = vi.spyOn(client, 'lookupAccount')
    const list = vi.spyOn(client, 'fetchAccountStatuses')
    await mount({ initial: initialOf([STATUS], '210') })
    expect(lookup).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })
})

describe('<caribou-profile> — keyed list', () => {
  it('does not re-render the header when the tab changes and the account does not', async () => {
    const el = await mount({ initial: initialOf([STATUS]) })
    const header = el.shadowRoot!.querySelector<CaribouProfileHeader>('caribou-profile-header')!
    const render = vi.spyOn(header, 'render')
    el.tab = 'media'
    await el.updateComplete
    await flush()
    expect(el.shadowRoot!.querySelector('caribou-profile-tabs')!.getAttribute('tab')).toBe('media')
    expect(render).not.toHaveBeenCalled()
    expect(el.shadowRoot!.querySelector('caribou-profile-header')).toBe(header)
  })

  it('keeps the existing rows and cards when another page arrives', async () => {
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const [card] = cards(el)
    const li = card!.parentElement
    const cardRender = vi.spyOn(card!, 'render')

    const older = status('209')
    cacheStatus(older)
    const store = (el as unknown as { store: ProfileStore }).store
    ;(store.statusIds as Signal<string[]>).value = ['210', '209']
    await el.updateComplete

    const after = cards(el)
    expect(after.map((c) => c.dataset.statusId)).toEqual(['210', '209'])
    expect(after[0]).toBe(card)
    expect(after[0]!.parentElement).toBe(li)
    expect(cardRender).not.toHaveBeenCalled()
  })

  // Every write to the shared status cache hands the store a new array of
  // the same statuses. That must not re-render the profile.
  it('does not re-render when the status cache changes for another list', async () => {
    const el = await mount({ initial: initialOf([STATUS]) })
    const render = vi.spyOn(el, 'render')
    cacheStatus(status('999'))
    await el.updateComplete
    await flush()
    expect(render).not.toHaveBeenCalled()
  })
})

describe('<caribou-profile> — pagination', () => {
  type IoCallback = (entries: Partial<IntersectionObserverEntry>[]) => void
  interface FakeObserver { callback: IoCallback; targets: Element[]; observeCalls: number }

  function stubIntersectionObserver(): FakeObserver[] {
    const observers: FakeObserver[] = []
    vi.stubGlobal('IntersectionObserver', class {
      private record: FakeObserver
      constructor(callback: IoCallback) {
        this.record = { callback, targets: [], observeCalls: 0 }
        observers.push(this.record)
      }
      observe(el: Element) { this.record.targets.push(el); this.record.observeCalls += 1 }
      disconnect() { this.record.targets = [] }
    })
    return observers
  }

  // The observer that watches the link right now, if there is one.
  function watching(observers: FakeObserver[], link: Element | null): FakeObserver | undefined {
    return observers.find((o) => link !== null && o.targets.includes(link))
  }

  function clickIsPrevented(link: Element): boolean {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    return click.defaultPrevented
  }

  const sentinelOf = (el: CaribouProfile) => el.shadowRoot!.querySelector<HTMLAnchorElement>('a[data-sentinel]')

  afterEach(() => { vi.unstubAllGlobals() })

  it('renders "Older posts" as a real link to the next page', async () => {
    const el = await mount({ tab: 'replies', initial: { ...initialOf([STATUS, status('209')], '209'), tab: 'replies' } })
    const next = el.shadowRoot!.querySelector<HTMLAnchorElement>('a[rel="next"][data-sentinel]')!
    expect(next.textContent).toBe('Older posts →')
    expect(next.getAttribute('href')).toBe('/@alice@example.social?tab=replies&max_id=209')
  })

  it('keeps the tabs and the next-page link on /@me for the own profile', async () => {
    const el = document.createElement('caribou-profile') as CaribouProfile
    el.handle = 'alice@example.social'
    el.linkHandle = 'me'
    el.initial = initialOf([STATUS], '210')
    document.body.appendChild(el)
    await flush()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('caribou-profile-tabs')!.getAttribute('handle')).toBe('me')
    expect(el.shadowRoot!.querySelector('a[rel="next"]')!.getAttribute('href')).toBe('/@me?tab=posts&max_id=210')
  })

  // Some non-Mastodon bridges mint ids with `/`, `:` or `&` in them.
  it('encodes the status id in the next-page link', async () => {
    const el = await mount({ initial: initialOf([status('odd:id/1&x')], 'odd:id/1&x') })
    expect(el.shadowRoot!.querySelector('a[rel="next"]')!.getAttribute('href'))
      .toBe('/@alice@example.social?tab=posts&max_id=odd%3Aid%2F1%26x')
  })

  it('renders no "Older posts" link when the server found no next page', async () => {
    const el = await mount({ initial: initialOf([STATUS], null) })
    expect(el.shadowRoot!.querySelector('a[rel="next"]')).toBeNull()
  })

  it('signed in: loads the next page when the link scrolls into view, then moves the link on', async () => {
    const observers = stubIntersectionObserver()
    const client = signIn()
    const list = vi.spyOn(client, 'fetchAccountStatuses').mockResolvedValue([status('209'), status('208')])
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const next = sentinelOf(el)!
    const observer = watching(observers, next)!
    expect(observer).toBeDefined()
    // In-place paging owns the link; a click must not also load a new page.
    expect(clickIsPrevented(next)).toBe(true)

    observer.callback([{ isIntersecting: true, target: next }])
    await flush()
    await el.updateComplete

    expect(list).toHaveBeenCalledWith('42', { tab: 'posts', maxId: '210' })
    expect(cards(el).map((c) => c.dataset.statusId)).toEqual(['210', '209', '208'])
    expect(sentinelOf(el)).toBe(next)
    expect(next.getAttribute('href')).toBe('/@alice@example.social?tab=posts&max_id=208')
  })

  // An observer reports a target only when its state changes. A short page
  // can leave the link in view, so the element asks for a fresh report.
  it('signed in: observes the link again after each page', async () => {
    const observers = stubIntersectionObserver()
    const client = signIn()
    vi.spyOn(client, 'fetchAccountStatuses').mockResolvedValue([status('209')])
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const next = sentinelOf(el)!
    const observer = watching(observers, next)!
    expect(observer.observeCalls).toBe(1)
    observer.callback([{ isIntersecting: true, target: next }])
    await flush()
    await el.updateComplete
    expect(observer.observeCalls).toBe(2)
    expect(observer.targets).toEqual([next])
  })

  // The profile shows no error state, so the link stays in view after a
  // failed load. A fresh report would retry the failing request without end.
  it('signed in: does not observe again after a failed load', async () => {
    const observers = stubIntersectionObserver()
    const client = signIn()
    const list = vi.spyOn(client, 'fetchAccountStatuses').mockRejectedValue(new Error('429'))
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const next = sentinelOf(el)!
    const observer = watching(observers, next)!
    observer.callback([{ isIntersecting: true, target: next }])
    await flush()
    await el.updateComplete
    expect(list).toHaveBeenCalledTimes(1)
    expect(observer.observeCalls).toBe(1)
    expect(sentinelOf(el)).toBe(next)
  })

  it('signed in: does not start a second load while one is running', async () => {
    const observers = stubIntersectionObserver()
    const client = signIn()
    const list = vi.spyOn(client, 'fetchAccountStatuses').mockResolvedValue([status('209')])
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const next = sentinelOf(el)!
    const observer = watching(observers, next)!
    observer.callback([{ isIntersecting: true, target: next }])
    observer.callback([{ isIntersecting: true, target: next }])
    await flush()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('signed in: removes the link when the next page is empty', async () => {
    const observers = stubIntersectionObserver()
    const client = signIn()
    vi.spyOn(client, 'fetchAccountStatuses').mockResolvedValue([])
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const next = sentinelOf(el)!
    watching(observers, next)!.callback([{ isIntersecting: true, target: next }])
    await flush()
    await el.updateComplete
    expect(sentinelOf(el)).toBeNull()
    expect(observers.every((o) => o.targets.length === 0)).toBe(true)
  })

  it('signed in: ignores a report that the link is out of view', async () => {
    const observers = stubIntersectionObserver()
    const client = signIn()
    const list = vi.spyOn(client, 'fetchAccountStatuses')
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const next = sentinelOf(el)!
    watching(observers, next)!.callback([{ isIntersecting: false, target: next }])
    await flush()
    expect(list).not.toHaveBeenCalled()
  })

  it('stops observing when it leaves the document', async () => {
    const observers = stubIntersectionObserver()
    signIn()
    const el = await mount({ initial: initialOf([STATUS], '210') })
    expect(watching(observers, sentinelOf(el))).toBeDefined()
    el.remove()
    expect(observers.every((o) => o.targets.length === 0)).toBe(true)
  })

  // A reader with no session still has JavaScript. A store with no client
  // fetches nothing and reports the end of the list, so taking the link over
  // would remove the only way to older posts.
  it('no session: keeps "Older posts" a plain link to the next server page', async () => {
    const observers = stubIntersectionObserver()
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const next = sentinelOf(el)!
    // Whatever watches the link gets told it is in view.
    for (const o of observers) o.callback([{ isIntersecting: true, target: next }])
    await flush()
    await el.updateComplete

    expect(sentinelOf(el)).toBe(next)
    expect(next.getAttribute('href')).toBe('/@alice@example.social?tab=posts&max_id=210')
    expect(cards(el).map((c) => c.dataset.statusId)).toEqual(['210'])
    expect(watching(observers, next)).toBeUndefined()
    expect(clickIsPrevented(next)).toBe(false)
  })

  it('takes the link over on sign-in and hands it back on sign-out', async () => {
    const observers = stubIntersectionObserver()
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const next = sentinelOf(el)!
    expect(watching(observers, next)).toBeUndefined()

    signIn()
    await el.updateComplete
    expect(watching(observers, next)).toBeDefined()
    expect(clickIsPrevented(next)).toBe(true)

    activeUserKey.value = null
    await el.updateComplete
    expect(watching(observers, next)).toBeUndefined()
    expect(clickIsPrevented(next)).toBe(false)
    expect(sentinelOf(el)).toBe(next)
  })
})
