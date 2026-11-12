import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeClient, activeUserKey, addUserSession, users, type UserSession } from '@beatzball/caribou-state'
import { type Instance, type Status } from '@beatzball/caribou-mastodon-client'
import '../caribou-compose-dialog.js'
import type { CaribouComposeDialog } from '../caribou-compose-dialog.js'

async function settle(el: CaribouComposeDialog) {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    while (!(await el.updateComplete)) { /* wait */ }
  }
}

async function mount() {
  addUserSession({
    userKey: 'alice@example.social', server: 'example.social', token: 'TOKEN',
    vapidKey: '', account: { id: 'alice', username: 'alice' }, createdAt: 1,
  } as unknown as UserSession)
  vi.spyOn(activeClient.value!, 'fetchInstance').mockResolvedValue({} as Instance)
  const el = document.createElement('caribou-compose-dialog')
  document.body.append(el)
  await settle(el)
  return el
}

async function open(el: CaribouComposeDialog) {
  el.show(null)
  await settle(el)
  return el.shadowRoot!.querySelector('dialog')!
}

let viewport: EventTarget & { height: number; offsetTop: number }

beforeEach(() => {
  localStorage.clear()
  viewport = Object.assign(new EventTarget(), { height: 600, offsetTop: 12 })
  vi.stubGlobal('visualViewport', viewport)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(345)
  vi.spyOn(window, 'scrollX', 'get').mockReturnValue(7)
})

afterEach(() => {
  document.body.replaceChildren()
  document.body.removeAttribute('style')
  document.documentElement.removeAttribute('style')
  activeUserKey.value = null
  users.value = new Map()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('compose viewport rules (#282)', () => {
  it('rule 1: takes the visual viewport height and offset, following resize and scroll', async () => {
    const el = await mount()
    const dialog = await open(el)
    expect(dialog.style.getPropertyValue('--compose-viewport-height')).toBe('600px')
    expect(dialog.style.getPropertyValue('--compose-viewport-top')).toBe('12px')
    viewport.height = 320
    viewport.offsetTop = 90
    viewport.dispatchEvent(new Event('resize'))
    expect(dialog.style.getPropertyValue('--compose-viewport-height')).toBe('320px')
    viewport.offsetTop = 110
    viewport.dispatchEvent(new Event('scroll'))
    expect(dialog.style.getPropertyValue('--compose-viewport-top')).toBe('110px')
  })

  it('rule 1: without visualViewport, leaves sizing to the CSS dvh fallback', async () => {
    vi.stubGlobal('visualViewport', undefined)
    const el = await mount()
    const dialog = await open(el)
    expect(dialog.open).toBe(true)
    expect(dialog.style.getPropertyValue('--compose-viewport-height')).toBe('')
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.position).not.toBe('fixed')
  })

  for (const path of ['Cancel', 'Post', 'Escape', 'account switch', 'navigation'] as const) {
    it(`rule 3: ${path} restores page styles and the same scroll position and removes listeners`, async () => {
      document.body.style.cssText = 'position: relative; top: 2px; padding-right: 5px; color: red;'
      document.documentElement.style.overflow = 'auto'
      const bodyStyle = document.body.style.cssText
      const rootStyle = document.documentElement.style.cssText
      const el = await mount()
      const create = vi.spyOn(activeClient.value!, 'createStatus').mockResolvedValue({ id: 'new' } as Status)
      const add = vi.spyOn(viewport, 'addEventListener')
      const remove = vi.spyOn(viewport, 'removeEventListener')
      const dialog = await open(el)
      expect(document.body.style.position).toBe('relative')
      expect(document.body.style.top).toBe('2px')
      expect(document.documentElement.style.overscrollBehavior).toBe('none')
      expect(document.documentElement.style.overflow).toBe('hidden')
      expect(add.mock.calls.map(([event]) => event)).toEqual(['resize', 'scroll'])
      if (path === 'Cancel') {
        el.shadowRoot!.querySelector<HTMLElement>('[data-action="cancel"]')!.click()
      } else if (path === 'Post') {
        const text = el.shadowRoot!.querySelector('textarea')!
        text.value = 'hello'
        text.dispatchEvent(new Event('input'))
        await settle(el)
        el.shadowRoot!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
      } else if (path === 'Escape') {
        // Native Escape closes the dialog, then fires close (the browser e2e
        // covers the actual key). happy-dom has no native key default action.
        dialog.close()
      } else if (path === 'account switch') {
        activeUserKey.value = null
      } else {
        el.remove() // The router removes the shell during navigation.
      }
      await settle(el)
      expect(document.body.style.cssText).toBe(bodyStyle)
      expect(document.documentElement.style.cssText).toBe(rootStyle)
      expect(window.scrollTo).not.toHaveBeenCalled()
      expect(remove.mock.calls).toEqual(add.mock.calls)
      if (path === 'Post') expect(create).toHaveBeenCalledOnce()
      const height = dialog.style.getPropertyValue('--compose-viewport-height')
      viewport.height = 200
      viewport.dispatchEvent(new Event('resize'))
      expect(dialog.style.getPropertyValue('--compose-viewport-height')).toBe(height)
    })
  }

  it('rule 3: an account switch before the opening render cancels the pending modal', async () => {
    const el = await mount()
    el.show(null)
    activeUserKey.value = null
    await settle(el)
    expect(el.shadowRoot!.querySelector('dialog')?.open ?? false).toBe(false)
    expect(document.body.style.position).toBe('')
  })

  it('rule 3: restores the saved position if the browser moved it while focusing', async () => {
    const el = await mount()
    await open(el)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(360)
    el.shadowRoot!.querySelector<HTMLElement>('[data-action="cancel"]')!.click()
    await settle(el)
    expect(window.scrollTo).toHaveBeenCalledWith(7, 345)
  })

  it('rule 3: compensates for a removed desktop scrollbar and restores padding', async () => {
    const el = await mount()
    document.body.style.paddingRight = '5px'
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockImplementation(() =>
      document.documentElement.style.overflow === 'hidden' ? 1000 : 985)
    await open(el)
    expect(document.body.style.paddingRight).toBe('20px')
    el.shadowRoot!.querySelector<HTMLElement>('[data-action="cancel"]')!.click()
    await settle(el)
    expect(document.body.style.paddingRight).toBe('5px')
  })
})
