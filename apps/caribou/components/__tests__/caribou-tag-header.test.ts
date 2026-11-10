import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tag } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, addUserSession, tagCache, users, type UserSession,
} from '@beatzball/caribou-state'
import '../caribou-tag-header.js'
import type { CaribouTagHeader } from '../caribou-tag-header.js'
import type { CaribouButton } from '../caribou-button.js'

const tag = (name: string, following: boolean) =>
  ({ id: '1', name, url: `https://example.social/tags/${name}`, following }) as Tag

function signIn(): NonNullable<typeof activeClient.value> {
  addUserSession({
    userKey: 'me@example.social', server: 'example.social', token: 'TOKEN', vapidKey: '',
    account: { id: '1', acct: 'me' }, createdAt: 1,
  } as unknown as UserSession)
  return activeClient.value!
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

async function mount(name = 'Caturday'): Promise<CaribouTagHeader> {
  const el = document.createElement('caribou-tag-header') as CaribouTagHeader
  el.name = name
  document.body.appendChild(el)
  await el.updateComplete
  await flush()
  await el.updateComplete
  return el
}

const button = (el: CaribouTagHeader) => el.shadowRoot!.querySelector<CaribouButton>('caribou-button.follow')
const inner = (el: CaribouTagHeader) => button(el)!.shadowRoot!.querySelector('button')!
const visibleLabel = (b: HTMLElement) =>
  [...b.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE || (n instanceof HTMLElement && !n.classList.contains('hover')))
    .map((n) => n.textContent).join('')

describe('<caribou-tag-header>', () => {
  afterEach(() => {
    document.body.replaceChildren()
    activeUserKey.value = null
    users.value = new Map()
    tagCache.value = new Map()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('shows the tag as a heading', async () => {
    const el = await mount('日本')
    expect(el.shadowRoot!.querySelector('h1')!.textContent).toBe('#日本')
  })

  // The server has no session; the first client render must equal its HTML.
  it('renders no button before mount, and none when signed out', async () => {
    const el = document.createElement('caribou-tag-header') as CaribouTagHeader
    el.name = 'ai'
    document.body.appendChild(el)
    await el.updateComplete
    expect(button(el)).toBeNull()
    await flush()
    expect(button(el)).toBeNull()
  })

  // Bluesky cannot follow a tag (#193): no button, and no tag read.
  it('shows no Follow and reads nothing when the network cannot follow tags', async () => {
    const client = signIn()
    const caps = { ...client.capabilities, followTags: false }
    vi.spyOn(client, 'capabilities', 'get').mockReturnValue(caps)
    const fetchTag = vi.spyOn(client, 'fetchTag').mockResolvedValue(tag('Caturday', false))
    const el = await mount()
    await flush()
    await el.updateComplete
    expect(button(el)).toBeNull()
    expect(fetchTag).not.toHaveBeenCalled()
  })

  it('follows the tag at once, then unfollows it', async () => {
    const client = signIn()
    const fetchTag = vi.spyOn(client, 'fetchTag').mockResolvedValue(tag('Caturday', false))
    const follow = vi.spyOn(client, 'followTag').mockResolvedValue(tag('Caturday', true))
    const unfollow = vi.spyOn(client, 'unfollowTag').mockResolvedValue(tag('Caturday', false))
    const el = await mount()
    expect(fetchTag).toHaveBeenCalledWith('Caturday')
    expect(button(el)?.textContent).toBe('Follow')
    expect(button(el)?.variant).toBe('primary')
    expect(button(el)!.parentElement?.getAttribute('aria-live')).toBe('polite')

    inner(el).click()
    await el.updateComplete
    expect(button(el)?.dataset.state).toBe('following')
    expect(visibleLabel(button(el)!)).toBe('Following')
    expect(button(el)!.querySelector('.hover')?.textContent).toBe('Unfollow')
    expect(follow).toHaveBeenCalledWith('Caturday')
    await flush()

    inner(el).click()
    await el.updateComplete
    expect(button(el)?.textContent).toBe('Follow')
    expect(unfollow).toHaveBeenCalledWith('Caturday')
  })

  it('shows Following for a tag the reader follows', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchTag').mockResolvedValue(tag('ai', true))
    const el = await mount('AI')
    expect(button(el)?.dataset.state).toBe('following')
  })

  it('reads the new tag when its name changes', async () => {
    const client = signIn()
    const fetchTag = vi.spyOn(client, 'fetchTag').mockImplementation(async (n) => tag(n, n === 'rust'))
    const el = await mount('ai')
    expect(button(el)?.dataset.state).toBe('follow')
    el.name = 'rust'
    await el.updateComplete
    await flush()
    await el.updateComplete
    expect(fetchTag).toHaveBeenLastCalledWith('rust')
    expect(el.shadowRoot!.querySelector('h1')!.textContent).toBe('#rust')
    expect(button(el)?.dataset.state).toBe('following')
  })

  it('shows no button when the read fails for a reason other than 404', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchTag').mockRejectedValue(Object.assign(new Error('503'), { code: 'server_error' }))
    const el = await mount('ai')
    expect(button(el)).toBeNull()
  })

  it('goes back to Follow when the follow fails', async () => {
    const client = signIn()
    vi.spyOn(client, 'fetchTag').mockResolvedValue(tag('ai', false))
    vi.spyOn(client, 'followTag').mockRejectedValue(new Error('500'))
    const el = await mount('ai')
    inner(el).click()
    await el.updateComplete
    expect(button(el)?.dataset.state).toBe('following')
    await flush()
    await el.updateComplete
    expect(button(el)?.dataset.state).toBe('follow')
  })
})
