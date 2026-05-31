import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  users, activeUserKey, addUserSession, type UserSession,
} from '@beatzball/caribou-state'

const key = toUserKey('beatzball', 'fosstodon.org')

function sampleSession(): UserSession {
  return {
    userKey: key,
    server: 'fosstodon.org',
    token: 'TOKEN-1',
    vapidKey: 'VAPID',
    account: { id: 'a1', username: 'beatzball', acct: 'beatzball' } as UserSession['account'],
    createdAt: 1_700_000_000_000,
  }
}

beforeAll(async () => {
  await import('../caribou-signout-form.js')
})

beforeEach(() => {
  document.body.innerHTML = ''
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  // happy-dom's HTMLFormElement.submit throws "Not implemented". Stub it.
  HTMLFormElement.prototype.submit = function () { /* no-op */ }
})

describe('<caribou-signout-form>', () => {
  it('does not render its own DOM (composite wrapper — preserves light-DOM children)', async () => {
    document.body.innerHTML = `
      <caribou-signout-form>
        <form action="/api/signout" method="post"><button type="submit">x</button></form>
      </caribou-signout-form>
    `
    await Promise.resolve()
    const wrapper = document.querySelector('caribou-signout-form')!
    expect(wrapper.shadowRoot).toBeNull()
    expect(wrapper.querySelector('form[action="/api/signout"]')).toBeTruthy()
  })

  it('clears activeUserKey + localStorage on form submit', async () => {
    addUserSession(sampleSession())
    expect(activeUserKey.value).toBe(key)
    expect(localStorage.getItem('caribou.activeUserKey')).toBe(JSON.stringify(key))

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    vi.spyOn(location, 'replace').mockImplementation(() => {})

    const wrapper = document.createElement('caribou-signout-form')
    const form = document.createElement('form')
    form.setAttribute('action', '/api/signout')
    form.setAttribute('method', 'post')
    const btn = document.createElement('button')
    btn.type = 'submit'
    form.appendChild(btn)
    wrapper.appendChild(form)
    document.body.appendChild(wrapper)
    await Promise.resolve()

    form.requestSubmit()

    expect(activeUserKey.value).toBeNull()
    expect(localStorage.getItem('caribou.activeUserKey')).toBe('null')
  })

  it('preventDefaults the native POST and fires a fetch instead', async () => {
    addUserSession(sampleSession())
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const replaceSpy = vi.spyOn(location, 'replace').mockImplementation(() => {})

    const wrapper = document.createElement('caribou-signout-form')
    const form = document.createElement('form')
    form.setAttribute('action', '/api/signout')
    form.setAttribute('method', 'post')
    const btn = document.createElement('button')
    btn.type = 'submit'
    form.appendChild(btn)
    wrapper.appendChild(form)
    document.body.appendChild(wrapper)
    await Promise.resolve()

    const submitEvent = new SubmitEvent('submit', { bubbles: true, cancelable: true })
    form.dispatchEvent(submitEvent)
    expect(submitEvent.defaultPrevented).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringMatching(/\/api\/signout$/), expect.objectContaining({ method: 'POST' }))

    await new Promise((r) => setTimeout(r, 0))
    expect(replaceSpy).toHaveBeenCalledWith('/')
  })
})
