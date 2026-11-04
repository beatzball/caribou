import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeUserKey, addUserSession, readPrefs, users, type UserSession } from '@beatzball/caribou-state'
import '../caribou-settings-keyboard.js'

const KEY = 'alice@example.social'

function signIn() {
  addUserSession({ userKey: KEY, server: 'example.social', token: 'T', vapidKey: '', createdAt: 1 } as unknown as UserSession)
}

async function mount() {
  const el = document.createElement('caribou-settings-keyboard')
  document.body.append(el)
  while (!(await el.updateComplete)) { /* wait */ }
  return el
}

const box = (el: HTMLElement) => el.shadowRoot!.querySelector<HTMLInputElement>('input[name="shortcuts"]')!

afterEach(() => {
  document.body.replaceChildren()
  users.value = new Map()
  activeUserKey.value = null
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('caribou-settings-keyboard', () => {
  it('is on by default, and unchecking saves shortcuts: false', async () => {
    signIn()
    const el = await mount()
    expect(box(el).checked).toBe(true)
    box(el).checked = false
    box(el).dispatchEvent(new Event('change'))
    await el.updateComplete
    expect(readPrefs(activeUserKey.peek()!).shortcuts).toBe(false)
  })

  it('shows the stored value', async () => {
    signIn()
    localStorage.setItem(`caribou.prefs.${KEY}`, JSON.stringify({ shortcuts: false }))
    const el = await mount()
    expect(box(el).checked).toBe(false)
  })

  it('puts the box back and says so when the save is refused', async () => {
    signIn()
    const el = await mount()
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('full') })
    box(el).checked = false
    box(el).dispatchEvent(new Event('change'))
    await el.updateComplete
    expect(box(el).checked).toBe(true)
    expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toContain('Not saved')
  })

  it('Show keyboard shortcuts asks for the help sheet', async () => {
    const el = await mount()
    const heard = vi.fn()
    window.addEventListener('caribou:shortcuts-help', heard)
    el.shadowRoot!.querySelector<HTMLElement>('caribou-button.show')!.click()
    window.removeEventListener('caribou:shortcuts-help', heard)
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
