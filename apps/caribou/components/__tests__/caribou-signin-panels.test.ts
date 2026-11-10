import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../caribou-signin-panels.js'
import * as session from '../_bluesky-session.js'
import { resetSigninDraft, type CaribouSigninPanels } from '../caribou-signin-panels.js'

// The router's swap on a full page load (#169): the server's page stays live
// while a second page renders hidden next to it, then the first is removed.
// What the reader chose and typed in the first must be in the second.

type Panels = CaribouSigninPanels & { updateComplete: Promise<unknown> }

function create(parent: ParentNode = document.body): Panels {
  const el = document.createElement('caribou-signin-panels') as Panels
  parent.appendChild(el)
  return el
}

async function settle(el: Panels) {
  await el.updateComplete
  await el.updateComplete
  for (const child of el.shadowRoot!.querySelectorAll('caribou-instance-picker, caribou-bluesky-signin')) {
    await (child as Panels).updateComplete
  }
}

const field = (el: Panels, name: string) =>
  el.shadowRoot!.querySelector(name === 'handle' ? 'caribou-bluesky-signin' : 'caribou-instance-picker')!
    .shadowRoot!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!

function type(el: Panels, name: string, value: string) {
  const input = field(el, name)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
}

const selected = (el: Panels) => el.shadowRoot!.querySelector('[role="tab"][aria-selected="true"]')!.id

beforeEach(() => resetSigninDraft())
afterEach(() => {
  document.body.replaceChildren()
  resetSigninDraft()
  vi.restoreAllMocks()
})

describe('caribou-signin-panels across the router swap', () => {
  it('the first render is always Mastodon, so the server and client match', async () => {
    const first = create()
    await settle(first)
    first.shadowRoot!.querySelector<HTMLElement>('#tab-bluesky')!.click()
    let firstRender = ''
    const next = document.createElement('caribou-signin-panels') as Panels
    const hook = next as unknown as { firstUpdated(...args: unknown[]): void }
    const orig = hook.firstUpdated
    hook.firstUpdated = function (this: Panels, ...args: unknown[]) {
      firstRender = selected(this)
      return orig.apply(this, args)
    }
    document.body.appendChild(next)
    await settle(next)
    expect(firstRender).toBe('tab-mastodon')
    expect(selected(next)).toBe('tab-bluesky')
  })

  it('a choice and text made before the second page renders are kept', async () => {
    const server = create()
    await settle(server)
    server.shadowRoot!.querySelector<HTMLElement>('#tab-bluesky')!.click()
    await settle(server)
    type(server, 'handle', 'alice.example.com')
    type(server, 'server', 'example.social')

    const client = create()
    await settle(client)
    server.remove()
    expect(selected(client)).toBe('tab-bluesky')
    expect(client.shadowRoot!.querySelector('#panel-bluesky')!.hasAttribute('hidden')).toBe(false)
    expect(field(client, 'handle').value).toBe('alice.example.com')
    expect(field(client, 'server').value).toBe('example.social')
  })

  it('a choice and text made while the second page waits hidden reach it', async () => {
    const server = create()
    await settle(server)
    const client = create()
    await settle(client)
    server.shadowRoot!.querySelector<HTMLElement>('#tab-bluesky')!.click()
    type(server, 'handle', 'alice.example.com')
    await settle(client)
    server.remove()
    expect(selected(client)).toBe('tab-bluesky')
    expect(field(client, 'handle').value).toBe('alice.example.com')
  })

  it('focus returns to the field the reader was in once the router shows the page', async () => {
    const outlet = document.createElement('litro-outlet')
    outlet.tabIndex = -1
    document.body.appendChild(outlet)
    const server = create(outlet)
    await settle(server)
    server.shadowRoot!.querySelector<HTMLElement>('#tab-bluesky')!.click()
    await settle(server)
    field(server, 'handle').focus()
    type(server, 'handle', 'alice')

    // The router appends the client page hidden, then removes the server
    // page, shows the client page and focuses the outlet.
    const page = document.createElement('div')
    page.setAttribute('hidden', '')
    outlet.appendChild(page)
    const client = create(page)
    await settle(client)
    server.remove()
    page.removeAttribute('hidden')
    outlet.focus()
    const bsky = client.shadowRoot!.querySelector('caribou-bluesky-signin')!
    await vi.waitFor(() => expect(bsky.shadowRoot!.activeElement).toBe(field(client, 'handle')))
  })
  it('focus is restored once: a later visit does not take it from the outlet', async () => {
    const outlet = document.createElement('litro-outlet')
    outlet.tabIndex = -1
    document.body.appendChild(outlet)
    const server = create(outlet)
    await settle(server)
    field(server, 'server').focus()
    const show = async () => {
      const page = document.createElement('div')
      page.setAttribute('hidden', '')
      outlet.appendChild(page)
      const el = create(page)
      await settle(el)
      for (const c of [...outlet.children]) if (c !== page) c.remove()
      page.removeAttribute('hidden')
      outlet.focus()
      return el
    }
    const first = await show()
    const picker = first.shadowRoot!.querySelector('caribou-instance-picker')!
    await vi.waitFor(() => expect(picker.shadowRoot!.activeElement).toBe(field(first, 'server')))
    // An SPA visit back to the landing: the router focuses the outlet.
    await show()
    await new Promise((r) => setTimeout(r, 20))
    expect(document.activeElement).toBe(outlet)
  })

  it('a Bluesky sign-in started before the swap shows on the new page, and is not started twice', async () => {
    let answer!: (message: string) => void
    const start = vi.spyOn(session, 'startBlueskySignIn').mockReturnValue(new Promise<string>((r) => { answer = r }))
    const server = create()
    await settle(server)
    server.shadowRoot!.querySelector<HTMLElement>('#tab-bluesky')!.click()
    type(server, 'handle', 'nope')
    const form = server.shadowRoot!.querySelector('caribou-bluesky-signin')!.shadowRoot!.querySelector('form')!
    form.dispatchEvent(new SubmitEvent('submit', { cancelable: true }))

    const client = create()
    await settle(client)
    server.remove()
    const bsky = client.shadowRoot!.querySelector('caribou-bluesky-signin')!
    await vi.waitFor(() => expect(bsky.shadowRoot!.textContent).toContain('Connecting…'))
    bsky.shadowRoot!.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { cancelable: true }))
    expect(start).toHaveBeenCalledTimes(1)

    answer('No account with that handle.')
    await vi.waitFor(() => expect(bsky.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain('No account'))
    expect(bsky.shadowRoot!.textContent).toContain('Sign in')
  })
})
