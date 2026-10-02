import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCapturedCode } from '../_error-code.js'
import '../caribou-error-banner.js'
import type { CaribouErrorBanner } from '../caribou-error-banner.js'

vi.mock('../_error-code.js', () => ({ getCapturedCode: vi.fn() }))

// The banner sets its code after the first update, which schedules a second
// one; `updateComplete` resolves false until no update is pending.
async function settled(el: CaribouErrorBanner): Promise<void> {
  while (!(await el.updateComplete)) { /* wait for the follow-up update */ }
}

async function mount(): Promise<CaribouErrorBanner> {
  const el = document.createElement('caribou-error-banner') as CaribouErrorBanner
  document.body.appendChild(el)
  await settled(el)
  return el
}

const alertOf = (el: Element) => el.shadowRoot!.querySelector('[role="alert"]')

describe('caribou-error-banner', () => {
  beforeEach(() => {
    vi.mocked(getCapturedCode).mockReset()
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('renders nothing when there is no error code', async () => {
    vi.mocked(getCapturedCode).mockReturnValue(null)
    const el = await mount()
    expect(alertOf(el)).toBeNull()
    expect(el.shadowRoot!.textContent?.trim()).toBe('')
  })

  it.each([
    ['denied', 'Sign-in was cancelled.'],
    ['state_mismatch', 'Sign-in expired or was tampered with. Try again.'],
    ['exchange_failed', "Couldn't complete sign-in with that instance. Try again."],
    ['verify_failed', "Couldn't verify your account with the instance. Try again."],
    ['unauthorized', 'Your session expired. Sign in again.'],
    ['unreachable', "Couldn't reach that instance. Check the spelling and try again."],
  ])('shows the message for %s in an alert', async (code, message) => {
    vi.mocked(getCapturedCode).mockReturnValue(code)
    const el = await mount()
    expect(alertOf(el)?.textContent?.trim()).toBe(message)
  })

  it('falls back to a generic message for an unknown code', async () => {
    vi.mocked(getCapturedCode).mockReturnValue('teapot')
    const el = await mount()
    expect(alertOf(el)?.textContent?.trim()).toBe('Sign-in error: teapot')
  })

  it('renders empty first, as the server does, and reads the code only after that', async () => {
    const el = document.createElement('caribou-error-banner') as CaribouErrorBanner
    let alertWhenCodeWasRead: Element | null | undefined
    let rendered = false
    vi.mocked(getCapturedCode).mockImplementation(() => {
      rendered = el.shadowRoot !== null && el.hasUpdated
      alertWhenCodeWasRead = alertOf(el)
      return 'denied'
    })
    document.body.appendChild(el)
    await settled(el)
    expect(rendered).toBe(true)
    expect(alertWhenCodeWasRead).toBeNull()
    expect(alertOf(el)).not.toBeNull()
  })

  it('shows the same code on every mount in one document', async () => {
    vi.mocked(getCapturedCode).mockReturnValue('denied')
    const first = await mount()
    const second = await mount()
    expect(alertOf(first)?.textContent).toContain('Sign-in was cancelled.')
    expect(alertOf(second)?.textContent).toContain('Sign-in was cancelled.')
  })
})
