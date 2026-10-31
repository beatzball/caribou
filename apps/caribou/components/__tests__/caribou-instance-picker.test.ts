import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../caribou-instance-picker.js'
import type { CaribouInstancePicker } from '../caribou-instance-picker.js'
import type { CaribouButton } from '../caribou-button.js'

async function mount(): Promise<CaribouInstancePicker> {
  const el = document.createElement('caribou-instance-picker') as CaribouInstancePicker
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const parts = (el: CaribouInstancePicker) => ({
  form: el.shadowRoot!.querySelector('form')!,
  input: el.shadowRoot!.querySelector<HTMLInputElement>('input[name="server"]')!,
  button: el.shadowRoot!.querySelector<CaribouButton>('caribou-button[type="submit"]')!,
  alert: el.shadowRoot!.querySelector('[role="alert"]'),
})

function submit(el: CaribouInstancePicker, server: string): SubmitEvent {
  const { form, input } = parts(el)
  input.value = server
  const e = new SubmitEvent('submit', { bubbles: true, cancelable: true })
  form.dispatchEvent(e)
  return e
}

// Resolves once the submit handler's fetch chain and the re-render are done.
async function settle(el: CaribouInstancePicker) {
  await new Promise((r) => setTimeout(r, 0))
  await el.updateComplete
}

const okResponse = () =>
  new Response(JSON.stringify({ authorizeUrl: 'https://example.social/oauth/authorize?x=1' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

describe('caribou-instance-picker', () => {
  // The picker navigates by assigning `location.href`; a plain object records
  // the assignment without happy-dom trying to load the target.
  let fakeLocation: { href: string }

  beforeEach(() => {
    fakeLocation = { href: 'http://localhost/' }
    vi.stubGlobal('location', fakeLocation)
  })

  afterEach(() => {
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders a labelled, required text input and a Sign in button', async () => {
    const el = await mount()
    const { input, button, alert } = parts(el)
    const label = el.shadowRoot!.querySelector('label')!
    expect(label.textContent).toBe('Your Mastodon instance')
    expect(label.getAttribute('for')).toBe(input.id)
    expect(input.type).toBe('text')
    expect(input.required).toBe(true)
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('placeholder')).toBe('mastodon.social')
    expect(button.textContent?.trim()).toBe('Sign in')
    expect(button.variant).toBe('primary')
    expect(button.loading).toBe(false)
    expect(alert).toBeNull()
  })

  it('POSTs the trimmed server to /api/signin/start and follows authorizeUrl', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
    const el = await mount()

    const e = submit(el, '  example.social  ')
    expect(e.defaultPrevented).toBe(true)
    await settle(el)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith('/api/signin/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: 'example.social' }),
    })
    expect(fakeLocation.href).toBe('https://example.social/oauth/authorize?x=1')
    expect(parts(el).alert).toBeNull()
  })

  it('shows "Connecting…" and marks the button busy while the request is pending', async () => {
    let respond!: (r: Response) => void
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>((r) => { respond = r }))
    const el = await mount()

    submit(el, 'example.social')
    await el.updateComplete
    expect(parts(el).button.textContent?.trim()).toBe('Connecting…')
    expect(parts(el).button.loading).toBe(true)

    respond(new Response(null, { status: 502 }))
    await settle(el)
    expect(parts(el).button.textContent?.trim()).toBe('Sign in')
    expect(parts(el).button.loading).toBe(false)
  })

  it('a click on Sign in submits the form', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
    const el = await mount()
    const { input, button } = parts(el)
    input.value = 'example.social'
    button.shadowRoot!.querySelector('button')!.click()
    await settle(el)
    await settle(el)
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fakeLocation.href).toBe('https://example.social/oauth/authorize?x=1')
  })

  it('ignores a second submit while one is pending', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(() => {}))
    const el = await mount()

    submit(el, 'example.social')
    await el.updateComplete
    const second = submit(el, 'example.social')

    expect(second.defaultPrevented).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not call the server for a blank value', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
    const el = await mount()

    const e = submit(el, '   ')
    await settle(el)

    expect(e.defaultPrevented).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(parts(el).button.textContent?.trim()).toBe('Sign in')
  })

  it('shows an alert and stays on the page when the server rejects the instance', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 502 }))
    const el = await mount()

    submit(el, 'nope.example')
    await settle(el)

    expect(parts(el).alert?.textContent).toBe('Could not reach that instance. Check the spelling and try again.')
    expect(fakeLocation.href).toBe('http://localhost/')
  })

  it('shows a network-error alert when the request throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))
    const el = await mount()

    submit(el, 'example.social')
    await settle(el)

    expect(parts(el).alert?.textContent).toBe('Network error — try again.')
    expect(parts(el).button.loading).toBe(false)
  })

  it('clears the previous error when a new attempt starts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 502 }))
    const el = await mount()
    submit(el, 'nope.example')
    await settle(el)
    expect(parts(el).alert).not.toBeNull()

    fetchSpy.mockReturnValueOnce(new Promise<Response>(() => {}))
    submit(el, 'example.social')
    await el.updateComplete
    expect(parts(el).alert).toBeNull()
  })

  describe('add', () => {
    async function mountAdd(): Promise<CaribouInstancePicker> {
      const el = document.createElement('caribou-instance-picker') as CaribouInstancePicker
      el.add = true
      document.body.appendChild(el)
      await el.updateComplete
      return el
    }

    it('POSTs add: true with the server', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse())
      const el = await mountAdd()
      submit(el, 'two.example')
      await settle(el)
      const init = fetchSpy.mock.calls[0]![1]!
      expect(JSON.parse(init.body as string)).toEqual({ server: 'two.example', add: true })
      expect(fakeLocation.href).toBe('https://example.social/oauth/authorize?x=1')
    })

    it('focuses the server field when it opens', async () => {
      const el = await mountAdd()
      expect(el.shadowRoot!.activeElement).toBe(parts(el).input)
    })

    it('does not take focus without add', async () => {
      const el = await mount()
      expect(el.shadowRoot!.activeElement).toBeNull()
    })

    // On a client-side navigation the router renders the page hidden, shows
    // it, then focuses its outlet. The field takes the focus after that.
    function routed() {
      const outlet = document.createElement('litro-outlet')
      outlet.tabIndex = -1
      document.body.appendChild(outlet)
      const page = document.createElement('div')
      page.setAttribute('hidden', '')
      const root = page.attachShadow({ mode: 'open' })
      const el = document.createElement('caribou-instance-picker') as CaribouInstancePicker
      el.add = true
      root.appendChild(el)
      outlet.appendChild(page)
      return { outlet, page, el }
    }

    // What the router does: show the page, then focus the outlet, in one go.
    function show(outlet: HTMLElement, page: HTMLElement) {
      page.removeAttribute('hidden')
      outlet.focus()
    }

    const flush = () => new Promise((r) => setTimeout(r, 0))

    it('takes the focus once the router shows the page and focuses the outlet', async () => {
      const { outlet, page, el } = routed()
      await el.updateComplete
      expect(el.shadowRoot!.activeElement).toBeNull()
      show(outlet, page)
      await flush()
      expect(el.shadowRoot!.activeElement).toBe(parts(el).input)
    })

    it('also when the outlet already had the focus (Safari after a click)', async () => {
      const { outlet, page, el } = routed()
      outlet.focus()
      await el.updateComplete
      show(outlet, page)
      await flush()
      expect(el.shadowRoot!.activeElement).toBe(parts(el).input)
    })

    it('a page that is removed before it is shown does not take the focus', async () => {
      const { outlet, page, el } = routed()
      await el.updateComplete
      page.remove()
      outlet.focus()
      await flush()
      expect(document.activeElement).toBe(outlet)
      expect(el.shadowRoot!.activeElement).toBeNull()
    })
  })
})
