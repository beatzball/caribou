import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toUserKey } from '@beatzball/caribou-auth'
import {
  users, activeUserKey, addUserSession, type UserSession,
} from '@beatzball/caribou-state'
import '../caribou-signout-form.js'
import type { CaribouSignoutForm } from '../caribou-signout-form.js'

const key = toUserKey('alice', 'example.social')

function sampleSession(): UserSession {
  return {
    userKey: key,
    server: 'example.social',
    token: 'TOKEN-1',
    vapidKey: 'VAPID',
    account: { id: 'a1', username: 'alice', acct: 'alice' } as UserSession['account'],
    createdAt: 1_700_000_000_000,
  }
}

async function mount(action: string | null = '/api/signout') {
  const wrapper = document.createElement('caribou-signout-form') as CaribouSignoutForm
  const form = document.createElement('form')
  if (action) form.setAttribute('action', action)
  form.setAttribute('method', 'post')
  const btn = document.createElement('button')
  btn.type = 'submit'
  form.appendChild(btn)
  wrapper.appendChild(form)
  document.body.appendChild(wrapper)
  await wrapper.updateComplete
  return { wrapper, form }
}

function submit(form: HTMLFormElement): SubmitEvent {
  const e = new SubmitEvent('submit', { bubbles: true, cancelable: true })
  form.dispatchEvent(e)
  return e
}

describe('caribou-signout-form', () => {
  beforeEach(() => {
    users.value = new Map()
    activeUserKey.value = null
    localStorage.clear()
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('keeps the consumer form as a light-DOM child and projects it through a slot', async () => {
    const { wrapper, form } = await mount()
    expect(wrapper.querySelector('form[action="/api/signout"]')).toBe(form)
    expect(wrapper.shadowRoot!.querySelector('slot')).toBeTruthy()
    expect(wrapper.shadowRoot!.querySelector('form')).toBeNull()
  })

  it('clears activeUserKey and localStorage on form submit', async () => {
    addUserSession(sampleSession())
    expect(activeUserKey.value).toBe(key)
    expect(localStorage.getItem('caribou.activeUserKey')).toBe(JSON.stringify(key))

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    vi.spyOn(location, 'replace').mockImplementation(() => {})

    const { form } = await mount()
    submit(form)

    expect(activeUserKey.value).toBeNull()
    expect(localStorage.getItem('caribou.activeUserKey')).toBe('null')
  })

  it('prevents the native POST, fetches instead, then hard-reloads to /', async () => {
    addUserSession(sampleSession())
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const replaceSpy = vi.spyOn(location, 'replace').mockImplementation(() => {})

    const { form } = await mount()
    const e = submit(form)
    expect(e.defaultPrevented).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/signout$/),
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    )
    // The reload waits for the POST, so the server sees the sign-out first.
    expect(replaceSpy).not.toHaveBeenCalled()

    await new Promise((r) => setTimeout(r, 0))
    expect(replaceSpy).toHaveBeenCalledWith('/')
  })

  it('still reloads to / when the POST fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const replaceSpy = vi.spyOn(location, 'replace').mockImplementation(() => {})

    const { form } = await mount()
    submit(form)

    await new Promise((r) => setTimeout(r, 0))
    expect(replaceSpy).toHaveBeenCalledWith('/')
  })

  it('stops intercepting once disconnected', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    vi.spyOn(location, 'replace').mockImplementation(() => {})

    const { wrapper, form } = await mount()
    wrapper.remove()
    // Detached from the document, but still parent and child.
    form.addEventListener('submit', (e) => e.preventDefault())
    submit(form)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
