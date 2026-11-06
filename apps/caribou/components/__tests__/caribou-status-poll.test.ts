import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, Poll, Status } from '@beatzball/caribou-mastodon-client'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  _testOnlyResetMutations, activeClient, activeUserKey, addUserSession, cacheStatus,
  statusCache, users,
} from '@beatzball/caribou-state'
import '../caribou-status-card.js'
import type { CaribouStatusCard } from '../caribou-status-card.js'
import { shares, timeLeft } from '../caribou-status-poll.js'
import type { CaribouStatusPoll } from '../caribou-status-poll.js'


const FUTURE = '2099-01-01T00:00:00.000Z'

function makePoll(over: Partial<Poll> = {}): Poll {
  return {
    id: 'p1', expiresAt: FUTURE, expired: false, multiple: false,
    votesCount: 4, votersCount: 4,
    options: [{ title: 'Tea 🍵', votesCount: 3, emojis: [] }, { title: '<b>Coffee</b>', votesCount: 1, emojis: [] }],
    emojis: [],
    ...over,
  } as Poll
}

function post(over: Record<string, unknown> = {}): Status {
  return {
    id: '7', content: '<p>which?</p>', visibility: 'public',
    account: { id: '42', acct: 'bob', username: 'bob', displayName: 'Bob', avatar: '', avatarStatic: '' },
    createdAt: '2026-04-28T12:00:00Z', poll: makePoll(),
    favourited: false, favouritesCount: 0, reblogged: false, reblogsCount: 0, bookmarked: false, repliesCount: 0,
    ...over,
  } as unknown as Status
}

function signIn(server = 'example.social') {
  addUserSession({
    userKey: toUserKey('alice', server), server, token: 't', vapidKey: '', createdAt: 0,
    account: { id: 'me', acct: 'alice', username: 'alice' } as Account,
  })
}

async function settle(el: { updateComplete: Promise<boolean> }) {
  while (!(await el.updateComplete)) { /* settle the post-mount render */ }
}

async function mount(status: Status, instance = 'example.social'): Promise<{ card: CaribouStatusCard; poll: CaribouStatusPoll }> {
  const card = document.createElement('caribou-status-card') as CaribouStatusCard
  card.status = status
  card.instance = instance
  document.body.appendChild(card)
  await settle(card)
  const poll = card.shadowRoot!.querySelector('caribou-status-poll') as CaribouStatusPoll
  if (poll) await settle(poll)
  return { card, poll }
}

const root = (p: CaribouStatusPoll) => p.shadowRoot!
const inputs = (p: CaribouStatusPoll) => [...root(p).querySelectorAll<HTMLInputElement>('input[name="choice"]')]
const voteBtn = (p: CaribouStatusPoll) => root(p).querySelector('caribou-button.vote') as HTMLElement & { disabled: boolean }
const toasts: string[] = []
const onToast = (e: Event) => { toasts.push((e as CustomEvent<{ message: string }>).detail.message) }

beforeEach(() => {
  document.body.replaceChildren()
  statusCache.value = new Map()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  _testOnlyResetMutations()
  toasts.length = 0
  window.addEventListener('caribou:toast', onToast)
})
afterEach(() => {
  window.removeEventListener('caribou:toast', onToast)
  vi.restoreAllMocks()
})

describe('shares and timeLeft', () => {
  it('divides by votes for one choice and by voters for several', () => {
    expect(shares(makePoll())).toEqual([75, 25])
    expect(shares(makePoll({ multiple: true, votesCount: 6, votersCount: 4, options: [
      { title: 'a', votesCount: 4, emojis: [] }, { title: 'b', votesCount: 2, emojis: [] }] as Poll['options'] }))).toEqual([100, 50])
    expect(shares(makePoll({ votesCount: 0, options: [{ title: 'a', votesCount: 0, emojis: [] }] as Poll['options'] }))).toEqual([0])
  })

  it('is null when the server hides the counts', () => {
    expect(shares(makePoll({ options: [{ title: 'a', emojis: [] }] as Poll['options'] }))).toBeNull()
  })

  it('says how long is left', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(timeLeft('2026-01-03T12:00:00Z', now)).toBe('2 days left')
    expect(timeLeft('2026-01-01T01:00:00Z', now)).toBe('1 hour left')
    expect(timeLeft('2026-01-01T00:05:00Z', now)).toBe('5 minutes left')
    expect(timeLeft('2026-01-01T00:00:10Z', now)).toBe('less than a minute left')
  })
})

describe('<caribou-status-poll> in a card', () => {
  it('a signed-out reader sees the results: shares, bars, titles as text, voters and the end', async () => {
    const { poll } = await mount(post())
    expect(inputs(poll)).toHaveLength(0)
    const rows = [...root(poll).querySelectorAll('li.result')]
    expect(rows.map((r) => r.querySelector('.share')?.textContent)).toEqual(['75%', '25%'])
    expect(rows[0]!.querySelector('.title')?.textContent).toBe('Tea 🍵')
    // A title is text, never markup.
    expect(rows[1]!.querySelector('.title')?.textContent).toBe('<b>Coffee</b>')
    expect(rows[1]!.querySelector('b')).toBeNull()
    expect((rows[0] as HTMLElement).style.getPropertyValue('--share')).toBe('75%')
    expect(root(poll).querySelector('.meta')?.textContent).toContain('4 people')
    expect(root(poll).querySelector('.meta')?.textContent).toMatch(/days left/)
    expect(root(poll).querySelector('caribou-button')).toBeNull()
  })

  it('an ended poll says so and marks the leader', async () => {
    const { poll } = await mount(post({ poll: makePoll({ expired: true, expiresAt: '2020-01-01T00:00:00Z' }) }))
    expect(root(poll).querySelector('.poll')?.getAttribute('data-state')).toBe('ended')
    expect(root(poll).textContent).toContain('Ended')
    expect(root(poll).querySelectorAll('li.result[data-leading]')).toHaveLength(1)
  })

  it('a poll whose end time passed counts as ended before the server says so', async () => {
    const { poll } = await mount(post({ poll: makePoll({ expiresAt: '2020-01-01T00:00:00Z' }) }))
    expect(root(poll).textContent).toContain('Ended')
  })

  it('hidden totals show no shares, with a note', async () => {
    const { poll } = await mount(post({ poll: makePoll({ options: [
      { title: 'a', votesCount: null, emojis: [] }, { title: 'b', votesCount: null, emojis: [] }] as unknown as Poll['options'] }) }))
    expect(root(poll).querySelectorAll('.share')).toHaveLength(0)
    expect(root(poll).textContent).toContain('Results show when the poll ends.')
  })

  it('a signed-in reader on another server sees results only', async () => {
    signIn('other.social')
    const { poll } = await mount(post())
    expect(inputs(poll)).toHaveLength(0)
  })

  it('single choice: radios, Vote disabled until one is picked, then the vote shows at once and the server poll after', async () => {
    signIn()
    cacheStatus(post())
    let resolve!: (p: Poll) => void
    const vote = vi.spyOn(activeClient.value!, 'votePoll').mockImplementation(() => new Promise((r) => { resolve = r }))
    const { poll } = await mount(post())
    expect(inputs(poll).map((i) => i.type)).toEqual(['radio', 'radio'])
    expect(voteBtn(poll).disabled).toBe(true)
    inputs(poll)[1]!.checked = true
    inputs(poll)[1]!.dispatchEvent(new Event('change'))
    await settle(poll)
    expect(voteBtn(poll).disabled).toBe(false)
    voteBtn(poll).click()
    await settle(poll)
    expect(vote).toHaveBeenCalledWith('p1', [1])
    expect(inputs(poll)).toHaveLength(0)
    expect(root(poll).querySelector('li.result:nth-child(2) .vh')?.textContent).toBe(', your choice')
    expect(root(poll).textContent).toContain('You voted')
    expect(root(poll).textContent).toContain('5 people')
    resolve(makePoll({ voted: true, ownVotes: [1], votesCount: 10, votersCount: 10 }))
    await vi.waitFor(() => expect(root(poll).textContent).toContain('10 people'))
  })

  it('multiple choice: checkboxes, several picks sent in order', async () => {
    signIn()
    const vote = vi.spyOn(activeClient.value!, 'votePoll').mockResolvedValue(makePoll({ multiple: true, voted: true, ownVotes: [0, 1] }))
    const { poll } = await mount(post({ poll: makePoll({ multiple: true }) }))
    expect(inputs(poll).map((i) => i.type)).toEqual(['checkbox', 'checkbox'])
    expect(root(poll).textContent).toContain('Choose one or more')
    for (const i of [1, 0]) {
      inputs(poll)[i]!.checked = true
      inputs(poll)[i]!.dispatchEvent(new Event('change'))
    }
    await settle(poll)
    voteBtn(poll).click()
    await vi.waitFor(() => expect(vote).toHaveBeenCalledWith('p1', [0, 1]))
  })

  it('a failed vote brings the choices back with a toast', async () => {
    signIn()
    vi.spyOn(activeClient.value!, 'votePoll').mockRejectedValue(new Error('boom'))
    vi.spyOn(activeClient.value!, 'fetchPoll').mockResolvedValue(makePoll())
    const { poll } = await mount(post())
    inputs(poll)[0]!.checked = true
    inputs(poll)[0]!.dispatchEvent(new Event('change'))
    await settle(poll)
    voteBtn(poll).click()
    await vi.waitFor(() => expect(toasts).toEqual(['Could not send your vote. Try again.']))
    await settle(poll)
    expect(inputs(poll)).toHaveLength(2)
    expect(inputs(poll)[0]!.checked).toBe(true)
  })

  it('picks survive a new copy of the same post, and go with another poll', async () => {
    signIn()
    const { card, poll } = await mount(post())
    inputs(poll)[1]!.checked = true
    inputs(poll)[1]!.dispatchEvent(new Event('change'))
    await settle(poll)
    card.status = post()
    await settle(card)
    await settle(poll)
    expect(inputs(poll)[1]!.checked).toBe(true)
    card.status = post({ poll: makePoll({ id: 'p2' }) })
    await settle(card)
    await settle(poll)
    expect(inputs(poll).some((i) => i.checked)).toBe(false)
  })

  it('a vote in one card shows in another card of the same post (a boost)', async () => {
    signIn()
    vi.spyOn(activeClient.value!, 'votePoll').mockResolvedValue(makePoll({ voted: true, ownVotes: [0], votesCount: 5 }))
    const boost = post({ id: 'w1', poll: null, reblog: post(), account: { id: '9', acct: 'carol', username: 'carol', avatar: '', avatarStatic: '' } })
    cacheStatus(post())
    cacheStatus(boost)
    const a = await mount(post())
    const b = await mount(boost)
    inputs(a.poll)[0]!.checked = true
    inputs(a.poll)[0]!.dispatchEvent(new Event('change'))
    await settle(a.poll)
    voteBtn(a.poll).click()
    await vi.waitFor(() => expect(inputs(b.poll)).toHaveLength(0))
    expect(root(b.poll).textContent).toContain('You voted')
  })

  it('Refresh asks for the poll and shows it', async () => {
    signIn()
    cacheStatus(post({ poll: makePoll({ voted: true, ownVotes: [0] }) }))
    const fetchPoll = vi.spyOn(activeClient.value!, 'fetchPoll').mockResolvedValue(makePoll({ voted: true, ownVotes: [0], votersCount: 40, votesCount: 40 }))
    const { poll } = await mount(post({ poll: makePoll({ voted: true, ownVotes: [0] }) }))
    ;(root(poll).querySelector('caribou-button.refresh') as HTMLElement).click()
    await vi.waitFor(() => expect(root(poll).textContent).toContain('40 people'))
    expect(fetchPoll).toHaveBeenCalledWith('p1')
  })

  it('a poll behind a content warning stays hidden until the warning opens', async () => {
    const { card } = await mount(post({ spoilerText: 'cw' }))
    expect(card.shadowRoot!.querySelector('caribou-status-poll')).toBeNull()
  })

  it('the first render prints the end in UTC, the same on any machine', async () => {
    const el = document.createElement('caribou-status-poll') as CaribouStatusPoll
    el.status = post({ poll: makePoll({ expiresAt: '2099-01-01T00:00:00.000Z' }) })
    // Rendered once, before firstUpdated sets the clock.
    const html = await import('lit').then(({ render }) => {
      const box = document.createElement('div')
      render(el.render(), box)
      return box.textContent ?? ''
    })
    expect(html).toContain('Ends Jan 1, 2099, 00:00 UTC')
  })

  it('the leader is named in text, and the lists keep their role', async () => {
    const { poll } = await mount(post({ poll: makePoll({ expired: true }) }))
    expect(root(poll).querySelector('li.result[data-leading] .vh')?.textContent).toBe(', most votes')
    expect(root(poll).querySelector('ul.results')?.getAttribute('role')).toBe('list')
    signIn()
    const open = await mount(post({ id: '8' }))
    expect(root(open.poll).querySelector('ul.choices')?.getAttribute('role')).toBe('list')
  })
})
