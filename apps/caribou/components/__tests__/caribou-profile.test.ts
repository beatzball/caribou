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

  function stubIntersectionObserver() {
    const observers: { callback: IoCallback; targets: Element[]; disconnected: boolean }[] = []
    vi.stubGlobal('IntersectionObserver', class {
      private record: (typeof observers)[number]
      constructor(callback: IoCallback) {
        this.record = { callback, targets: [], disconnected: false }
        observers.push(this.record)
      }
      observe(el: Element) { this.record.targets.push(el) }
      disconnect() { this.record.disconnected = true }
    })
    return observers
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('renders "Older posts" as a real link to the next page', async () => {
    const el = await mount({ tab: 'replies', initial: { ...initialOf([STATUS, status('209')], '209'), tab: 'replies' } })
    const next = el.shadowRoot!.querySelector<HTMLAnchorElement>('a[rel="next"][data-sentinel]')!
    expect(next.textContent).toBe('Older posts →')
    expect(next.getAttribute('href')).toContain('tab=replies&max_id=209')
  })

  it('renders no "Older posts" link when the server found no next page', async () => {
    const el = await mount({ initial: initialOf([STATUS], null) })
    expect(el.shadowRoot!.querySelector('a[rel="next"]')).toBeNull()
  })

  it('loads the next page when the link scrolls into view, then moves the link on', async () => {
    const observers = stubIntersectionObserver()
    const client = signIn()
    const list = vi.spyOn(client, 'fetchAccountStatuses').mockResolvedValue([status('209'), status('208')])
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const next = el.shadowRoot!.querySelector<HTMLAnchorElement>('a[data-sentinel]')!
    expect(observers.at(-1)!.targets).toEqual([next])

    observers.at(-1)!.callback([{ isIntersecting: true, target: next }])
    await flush()
    await el.updateComplete

    expect(list).toHaveBeenCalledWith('42', { tab: 'posts', maxId: '210' })
    expect(cards(el).map((c) => c.dataset.statusId)).toEqual(['210', '209', '208'])
    expect(el.shadowRoot!.querySelector('a[data-sentinel]')).toBe(next)
    expect(next.getAttribute('href')).toContain('max_id=208')
    // The store owns pagination now; a click must not also load a new page.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    next.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })

  it('removes the link when the next page is empty', async () => {
    const observers = stubIntersectionObserver()
    const client = signIn()
    vi.spyOn(client, 'fetchAccountStatuses').mockResolvedValue([])
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const next = el.shadowRoot!.querySelector('a[data-sentinel]')!
    observers.at(-1)!.callback([{ isIntersecting: true, target: next }])
    await flush()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('a[data-sentinel]')).toBeNull()
    expect(observers.at(-1)!.disconnected).toBe(true)
  })

  it('leaves the link alone until it scrolls into view', async () => {
    const observers = stubIntersectionObserver()
    signIn()
    const el = await mount({ initial: initialOf([STATUS], '210') })
    const next = el.shadowRoot!.querySelector('a[data-sentinel]')!
    observers.at(-1)!.callback([{ isIntersecting: false, target: next }])
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    next.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
  })

  it('stops observing when it leaves the document', async () => {
    const observers = stubIntersectionObserver()
    signIn()
    const el = await mount({ initial: initialOf([STATUS], '210') })
    el.remove()
    expect(observers.at(-1)!.disconnected).toBe(true)
  })
})
