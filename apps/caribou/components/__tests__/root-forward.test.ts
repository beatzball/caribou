import { describe, it, expect, vi, afterEach } from 'vitest'
import { forwardsToHome } from '../_root-forward.js'
import { ROOT_FORWARD_HEAD } from '../../server/lib/root-forward-head.js'

type Store = Record<string, string>

const KEY = 'alice@example.social'
const signedIn: Store = {
  'caribou.activeUserKey': JSON.stringify(KEY),
  'caribou.users': JSON.stringify([[KEY, { userKey: KEY, token: 'T', server: 'example.social' }]]),
}

// Each case: the query string, localStorage, sessionStorage, and whether `/`
// goes to `/home`. The client check and the inline head script must agree.
const CASES: Array<[string, string, Store | null, Store | null, boolean]> = [
  ['signed in', '', signedIn, {}, true],
  ['signed in, other query', '?utm=x', signedIn, {}, true],
  ['add an account', '?add', signedIn, {}, false],
  ['add an account (value)', '?add=1', signedIn, {}, false],
  ['sign-in error in the URL', '?error=denied', signedIn, {}, false],
  ['sign-in error stashed', '', signedIn, { 'caribou.error': 'unauthorized' }, false],
  ['no accounts', '', {}, {}, false],
  ['no active account', '', { ...signedIn, 'caribou.activeUserKey': 'null' }, {}, false],
  ['active key not stored', '', { ...signedIn, 'caribou.users': '[]' }, {}, false],
  ['active key not a user key', '', {
    'caribou.activeUserKey': JSON.stringify('nope'),
    'caribou.users': JSON.stringify([['nope', {}]]),
  }, {}, false],
  ['broken JSON', '', { 'caribou.activeUserKey': '{', 'caribou.users': '[' }, {}, false],
  ['users not a list', '', { ...signedIn, 'caribou.users': '{}' }, {}, false],
  ['storage blocked', '', null, null, false],
]

function storage(store: Store | null): Storage {
  if (!store) {
    return { getItem: () => { throw new DOMException('blocked', 'SecurityError') } } as unknown as Storage
  }
  return { getItem: (k: string) => (k in store ? store[k] : null) } as unknown as Storage
}

// Runs the head script with fake globals. Returns where it navigated, if anywhere.
function runHeadScript(search: string, local: Store | null, session: Store | null) {
  const body = ROOT_FORWARD_HEAD.replace(/^<script>/, '').replace(/<\/script>$/, '')
  const replace = vi.fn()
  const root = { style: { visibility: '' }, setAttribute: vi.fn(), removeAttribute: vi.fn() }
  const win = { addEventListener: vi.fn() }
  new Function('location', 'localStorage', 'sessionStorage', 'document', 'window', 'setTimeout', body)(
    { search, replace }, storage(local), storage(session), { documentElement: root }, win, () => 0,
  )
  return { replace, root, win }
}

describe('forwardsToHome (client check)', () => {
  it.each(CASES)('%s', (_name, search, local, session, expected) => {
    expect(forwardsToHome(search, storage(local), storage(session))).toBe(expected)
  })
})

describe('ROOT_FORWARD_HEAD (inline script before first paint)', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(CASES)('%s', (_name, search, local, session, expected) => {
    const { replace, root } = runHeadScript(search, local, session)
    if (expected) {
      expect(replace).toHaveBeenCalledWith('/home')
      // Hidden, so the sign-in form does not flash while /home loads.
      expect(root.style.visibility).toBe('hidden')
      expect(root.setAttribute).toHaveBeenCalledWith('data-caribou-forward', '')
    } else {
      expect(replace).not.toHaveBeenCalled()
      expect(root.style.visibility).toBe('')
    }
  })

  it('checks again when the page comes back from the back-forward cache', () => {
    const { win } = runHeadScript('', {}, {})
    expect(win.addEventListener).toHaveBeenCalledWith('pageshow', expect.any(Function))
  })

  it('is one plain inline script with no closing tag inside', () => {
    expect(ROOT_FORWARD_HEAD.startsWith('<script>')).toBe(true)
    expect(ROOT_FORWARD_HEAD.indexOf('</script>')).toBe(ROOT_FORWARD_HEAD.length - '</script>'.length)
  })
})
