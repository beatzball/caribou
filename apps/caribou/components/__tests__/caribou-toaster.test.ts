import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../caribou-toaster.js'
import { TOAST_TIMEOUT_MS, type CaribouToaster, type ToastDetail } from '../caribou-toaster.js'

async function mount(): Promise<CaribouToaster> {
  const el = document.createElement('caribou-toaster') as CaribouToaster
  document.body.appendChild(el)
  while (!(await el.updateComplete)) { /* settle the post-mount render */ }
  return el
}

function toast(detail: Partial<ToastDetail> | null) {
  window.dispatchEvent(new CustomEvent('caribou:toast', { detail }))
}

const messages = (el: CaribouToaster, role: 'alert' | 'status') =>
  [...el.shadowRoot!.querySelectorAll(role === 'alert' ? '[role="alert"] .message' : '[role="status"] .message')]
    .map((m) => m.textContent)

beforeEach(() => {
  document.body.replaceChildren()
  vi.useFakeTimers()
})
afterEach(() => { vi.useRealTimers() })

describe('<caribou-toaster>', () => {
  it('renders an empty polite region and no empty alert', async () => {
    const el = await mount()
    expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull()
    expect(el.shadowRoot!.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite')
    expect(el.shadowRoot!.querySelectorAll('.toast')).toHaveLength(0)
  })

  it('puts errors in the alert region and info in the status region', async () => {
    const el = await mount()
    toast({ kind: 'error', message: 'Could not favourite this post.' })
    toast({ kind: 'info', message: 'Saved.' })
    await el.updateComplete
    expect(messages(el, 'alert')).toEqual(['Could not favourite this post.'])
    expect(el.shadowRoot!.querySelectorAll('.toast[role="alert"]')).toHaveLength(1)
    expect(messages(el, 'status')).toEqual(['Saved.'])
  })

  it('treats an unknown kind as info and ignores an event with no message', async () => {
    const el = await mount()
    toast({ message: 'Hi' })
    toast({ kind: 'error' })
    toast({ kind: 'error', message: '' })
    toast(null)
    await el.updateComplete
    expect(messages(el, 'status')).toEqual(['Hi'])
    expect(messages(el, 'alert')).toEqual([])
  })

  it('auto-dismisses after the timeout', async () => {
    const el = await mount()
    toast({ kind: 'error', message: 'a' })
    await el.updateComplete
    vi.advanceTimersByTime(TOAST_TIMEOUT_MS - 1)
    await el.updateComplete
    expect(messages(el, 'alert')).toEqual(['a'])
    vi.advanceTimersByTime(1)
    await el.updateComplete
    expect(messages(el, 'alert')).toEqual([])
  })

  it('the dismiss button removes only its toast', async () => {
    const el = await mount()
    toast({ kind: 'error', message: 'a' })
    toast({ kind: 'error', message: 'b' })
    await el.updateComplete
    const buttons = el.shadowRoot!.querySelectorAll<HTMLButtonElement>('button[aria-label="Dismiss"]')
    buttons[0]!.click()
    await el.updateComplete
    expect(messages(el, 'alert')).toEqual(['b'])
  })

  it('keeps at most four toasts, dropping the oldest', async () => {
    const el = await mount()
    for (const m of ['1', '2', '3', '4', '5']) toast({ kind: 'info', message: m })
    await el.updateComplete
    expect(messages(el, 'status')).toEqual(['2', '3', '4', '5'])
  })

  it('stops listening and clears its timers when removed', async () => {
    const el = await mount()
    toast({ kind: 'info', message: 'a' })
    await el.updateComplete
    el.remove()
    toast({ kind: 'info', message: 'b' })
    expect(vi.getTimerCount()).toBe(0)
    document.body.appendChild(el)
    await el.updateComplete
    expect(messages(el, 'status')).toEqual([])
  })
})
