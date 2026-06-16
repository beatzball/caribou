import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import { definePageData } from '@beatzball/litro'
import { getQuery, getRouterParams } from 'h3'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import {
  fetchAccountByHandle, fetchAccountStatuses,
} from '../server/lib/mastodon-public.js'
import { getStorage } from '../server/lib/storage.js'
import type { ProfilePageData, ShellInfo } from '../server/lib/page-data-types.js'
import './components/caribou-app-shell.js'
import './components/caribou-profile.js'
import './components/caribou-auth-required.js'

type Tab = 'posts' | 'replies' | 'media'

function parseTab(raw: unknown): Tab {
  return raw === 'replies' || raw === 'media' ? raw : 'posts'
}

export type HandlePageData = ProfilePageData & { shell: ShellInfo; handle: string }

export const pageData = definePageData<HandlePageData>(async (event) => {
  const params = getRouterParams(event) as { handle?: string }
  const handle = String(params.handle ?? '')
  const resolution = await resolveInstanceForRoute(event, { handle }, { storage: getStorage() })
  const shell: ShellInfo = { instance: resolution.instance }
  // /@me is auth-required (Plan 3 design §8.8): the user's own profile is
  // gated by the access token that lives only in localStorage, so the server
  // never performs a public lookup for `me`. Render a placeholder; the client
  // swap (HandlePage.connectedCallback) hydrates the real profile from the
  // active userKey, mirroring /home.
  if (handle === 'me') return { kind: 'auth-required', shell, handle } as HandlePageData
  if (!resolution.instance) return { kind: 'auth-required', shell, handle } as HandlePageData
  const query = getQuery(event)
  const tab = parseTab(query.tab)
  const maxId = typeof query.max_id === 'string' ? query.max_id : undefined
  try {
    const account = await fetchAccountByHandle(handle, { instance: resolution.instance })
    const rawStatuses = await fetchAccountStatuses(account.id, {
      instance: resolution.instance,
      tab,
      maxId,
    })
    // Pre-sanitize at the SSR boundary: the status cards and profile header
    // now render this markup server-side, where DOMPurify can't run (no
    // window). Dynamic import keeps the jsdom-backed sanitizer out of the
    // client bundle — the fetcher never runs on the client. Mirrors local.ts.
    const { sanitize } = await import('../server/lib/sanitize.js')
    const safeAccount = { ...account, note: sanitize(account.note ?? '') }
    const statuses = rawStatuses.map((s) => ({
      ...s,
      content: sanitize(s.content ?? ''),
      ...(s.reblog ? { reblog: { ...s.reblog, content: sanitize(s.reblog.content ?? '') } } : {}),
    }))
    const nextMaxId = statuses.length > 0 ? statuses[statuses.length - 1]!.id : null
    return { kind: 'ok', account: safeAccount, statuses, nextMaxId, tab, shell, handle } as HandlePageData
  } catch (err) {
    return { kind: 'error', message: String(err), shell, handle } as HandlePageData
  }
})

export default class HandlePage extends LitroPage {
  static override tagName = 'page-handle'

  override connectedCallback() {
    super.connectedCallback?.()
    if (typeof window === 'undefined') return
    const data = this.serverData as HandlePageData | null
    if (data?.handle !== 'me') return
    queueMicrotask(() => this.maybeSwapToOwnProfile())
  }

  // Mirrors /home: when JS hydrates a signed-in session, replace the
  // auth-required placeholder with a real <caribou-profile> driven by the
  // active userKey from localStorage. The component's authenticated client
  // (activeClient.value) handles the actual lookup — the server never sees
  // it. Same DOM swap pattern as HomePage.maybeSwapToTimeline.
  private maybeSwapToOwnProfile() {
    const meRaw = localStorage.getItem('caribou.activeUserKey')
    if (!meRaw) return
    let userKey: unknown
    try { userKey = JSON.parse(meRaw) } catch { return }
    if (typeof userKey !== 'string' || userKey.split('@').length !== 2) return
    const shell = this.querySelector('caribou-app-shell')
    if (!shell) return
    const tab = new URLSearchParams(window.location.search).get('tab') ?? 'posts'
    const real = document.createElement('caribou-profile')
    real.setAttribute('handle', userKey)
    real.setAttribute('tab', tab)
    shell.replaceChildren(real)
  }

  override render() {
    const data = (this.serverData ?? { kind: 'auth-required', shell: { instance: null }, handle: '' }) as HandlePageData
    const inst = data.shell.instance ?? ''
    if (data.kind === 'auth-required') {
      const label = data.handle === 'me'
        ? 'Your profile shows posts from your signed-in account. It requires a Mastodon access token, which Caribou keeps on your device.'
        : 'Profiles by bare handle (@user without @host) need to know which instance to query.'
      return html`
        <caribou-app-shell instance="${inst}">
          <caribou-auth-required label="${label}"></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'error') {
      return html`
        <caribou-app-shell instance="${inst}">
          <article class="p-4 fg-muted" role="alert">
            Couldn't load profile @${data.handle}.
          </article>
        </caribou-app-shell>
      `
    }
    // Seed the profile via the `initial` attribute (object-typed prop →
    // Elena JSON-parses it at SSR and on hydration), so the component
    // SSR-paints the header + status cards instead of flashing "Loading…".
    // Mirrors local.ts's `<caribou-timeline initial=...>`.
    const initial = JSON.stringify({
      account: data.account,
      statuses: data.statuses,
      nextMaxId: data.nextMaxId,
      tab: data.tab,
    })
    return html`
      <caribou-app-shell instance="${inst}">
        <caribou-profile handle="${data.handle}" tab="${data.tab}" initial="${initial}"></caribou-profile>
      </caribou-app-shell>
    `
  }
}
HandlePage.define()
