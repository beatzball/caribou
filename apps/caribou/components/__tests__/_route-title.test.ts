import { afterEach, describe, expect, it } from 'vitest'
import { routeTitle } from '../_route-title.js'
import { startRouteTitles } from '../_route-titles.js'

const url = (path: string) => new URL(path, 'https://example.test')
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
let stop: (() => void) | undefined
afterEach(() => { stop?.(); document.body.replaceChildren(); history.replaceState(null, '', '/') })

describe('rule 1: descriptive route names', () => {
  it.each([
    ['/', 'Welcome'], ['/home', 'Home'], ['/local', 'Local'], ['/public', 'Public'],
    ['/notifications', 'Notifications'], ['/search', 'Search'], ['/search?q=two+words', 'Search: two words'],
    ['/feeds', 'Feeds'], ['/lists', 'Lists'], ['/lists/42', 'List'], ['/bookmarks', 'Bookmarks'],
    ['/settings', 'Settings'], ['/settings/moderation', 'Moderation settings'],
    ['/about', 'About'], ['/privacy', 'Privacy'], ['/changelog', 'Changelog'],
    ['/signin/bluesky', 'Sign in with Bluesky'], ['/blog', 'Blog'], ['/blog/hello-world', 'Post: hello-world'],
    ['/tags/Caf%C3%A9', '#Café'], ['/@alice@example.social', 'Profile'], ['/@alice.example.com/abc', 'Thread'],
  ])('%s names its destination', (path, title) => {
    expect(routeTitle(url(path))).toBe(`${title} · Caribou`)
  })

  it('uses only a supplied visible dynamic name', () => {
    expect(routeTitle(url('/@alice.example.com'), 'Alice')).toBe('Alice · Caribou')
    expect(routeTitle(url('/lists/42'), 'Birdwatching')).toBe('Birdwatching · Caribou')
    expect(routeTitle(url('/@alice.example.com/abc'), 'Alice')).toBe('Thread by Alice · Caribou')
  })
})

it('rule 2: a hidden or departed page cannot overwrite the current title', async () => {
  history.replaceState(null, '', '/lists/42')
  const outlet = document.createElement('litro-outlet')
  document.body.append(outlet)
  const old = document.createElement('page-lists-id')
  old.attachShadow({ mode: 'open' }).innerHTML = '<caribou-list-header></caribou-list-header>'
  const header = old.shadowRoot!.firstElementChild!
  header.attachShadow({ mode: 'open' }).innerHTML = '<h1>Birdwatching</h1>'
  outlet.append(old)
  stop = startRouteTitles(outlet)
  await flush()
  expect(document.title).toBe('Birdwatching · Caribou')
  history.pushState(null, '', '/settings')
  window.dispatchEvent(new PopStateEvent('popstate'))
  expect(document.title).toBe('Settings · Caribou')
  header.shadowRoot!.querySelector('h1')!.textContent = 'Late old name'
  await flush()
  expect(document.title).toBe('Settings · Caribou')
  old.remove()
  header.shadowRoot!.querySelector('h1')!.textContent = 'Detached name'
  await flush()
  expect(document.title).toBe('Settings · Caribou')
})

it('rule 2: a prepared hidden page cannot supply a name before the swap', async () => {
  history.replaceState(null, '', '/lists/42')
  const outlet = document.createElement('litro-outlet')
  document.body.append(outlet)
  const page = document.createElement('page-lists-id')
  page.hidden = true
  page.attachShadow({ mode: 'open' }).innerHTML = '<caribou-list-header></caribou-list-header>'
  const header = page.shadowRoot!.firstElementChild!
  header.attachShadow({ mode: 'open' }).innerHTML = '<h1>Birdwatching</h1>'
  outlet.append(page)
  stop = startRouteTitles(outlet)
  await flush()
  expect(document.title).toBe('List · Caribou')
  page.hidden = false
  await flush()
  expect(document.title).toBe('Birdwatching · Caribou')
})

it('rule 2: a DID-to-handle rewrite keeps the mounted profile title', async () => {
  const { replaceDidRoute } = await import('../_bluesky-route.js')
  history.replaceState(null, '', '/@did:plc:alice')
  const outlet = document.createElement('litro-outlet')
  document.body.append(outlet)
  const page = document.createElement('page-handle')
  page.attachShadow({ mode: 'open' }).innerHTML = '<caribou-profile-header></caribou-profile-header>'
  const header = page.shadowRoot!.firstElementChild!
  header.attachShadow({ mode: 'open' }).innerHTML = '<h1>Alice</h1>'
  outlet.append(page)
  stop = startRouteTitles(outlet)
  expect(document.title).toBe('Alice · Caribou')
  replaceDidRoute(window, 'did:plc:alice', { acct: 'alice.example.com', bluesky: { did: 'did:plc:alice', handleInvalid: false } })
  header.shadowRoot!.querySelector('h1')!.textContent = 'Alice Example'
  await flush()
  expect(document.title).toBe('Alice Example · Caribou')
})
