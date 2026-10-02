import { html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { LitroPage, pageReset } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { getQuery, getRouterParams } from 'h3'
import { activeUserKey } from '@beatzball/caribou-state'
import { resolveInstanceForRoute } from '../server/lib/resolve-instance.js'
import {
  fetchAccountByHandle, fetchAccountStatuses,
} from '../server/lib/mastodon-public.js'
import { getStorage } from '../server/lib/storage.js'
import type { ProfilePageData, ShellInfo } from '../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-auth-required.js'
import '../components/caribou-profile.js'

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
  // never performs a public lookup for `me`. It renders a placeholder; the
  // page swaps in the real profile on the client, the way /home does.
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
    // The fetcher never runs on the client; the dynamic import keeps the
    // jsdom-backed sanitizer out of the client bundle.
    const { sanitizeAccount, sanitizeStatus } = await import('../server/lib/sanitize.js')
    const statuses = rawStatuses.map(sanitizeStatus)
    const nextMaxId = statuses.length > 0 ? statuses[statuses.length - 1]!.id : null
    return {
      kind: 'ok', account: sanitizeAccount(account), statuses, nextMaxId, tab, shell, handle,
    } as HandlePageData
  } catch (err) {
    return { kind: 'error', message: String(err), shell, handle } as HandlePageData
  }
})

@customElement('page-handle')
export class HandlePage extends LitroPage {
  static override styles = [pageReset, css`
    article { padding: 1rem; color: var(--fg-muted); }
  `]

  // On /@me: the signed-in user and the tab from the address bar. The server
  // knows neither, so both are read after the first update; the first render
  // is the placeholder the server sent.
  @state() private me: { userKey: string; tab: Tab } | null = null

  protected override firstUpdated() {
    const data = this.serverData as HandlePageData | null
    if (data?.handle !== 'me') return
    const userKey = activeUserKey.value
    if (!userKey) return
    this.me = { userKey, tab: parseTab(new URLSearchParams(window.location.search).get('tab')) }
  }

  override render() {
    const data = (this.serverData ?? { kind: 'auth-required', shell: { instance: null }, handle: '' }) as HandlePageData
    const inst = data.shell.instance ?? ''
    if (data.kind === 'auth-required' && this.me) {
      // No `initial`: the profile looks the account up through the signed-in
      // client, which holds the token the server never sees.
      return html`
        <caribou-app-shell instance=${inst}>
          <caribou-profile handle=${this.me.userKey} tab=${this.me.tab}></caribou-profile>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'auth-required') {
      const label = data.handle === 'me'
        ? 'Your profile shows posts from your signed-in account. It requires a Mastodon access token, which Caribou keeps on your device.'
        : 'Profiles by bare handle (@user without @host) need to know which instance to query.'
      return html`
        <caribou-app-shell instance=${inst}>
          <caribou-auth-required label=${label}></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'error') {
      return html`
        <caribou-app-shell instance=${inst}>
          <article role="alert">
            Couldn't load profile @${data.handle}.
          </article>
        </caribou-app-shell>
      `
    }
    return html`
      <caribou-app-shell instance=${inst}>
        <caribou-profile handle=${data.handle} tab=${data.tab} .initial=${data}></caribou-profile>
      </caribou-app-shell>
    `
  }
}

export default HandlePage
