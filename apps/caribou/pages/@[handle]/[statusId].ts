import { html, css } from 'lit'
import { customElement } from 'lit/decorators.js'
import { LitroPage, pageReset } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { getRouterParams } from 'h3'
import { getInstance } from '../../server/lib/instance-cookie.js'
import {
  fetchStatus, fetchThreadContext,
} from '../../server/lib/mastodon-public.js'
import { getStorage } from '../../server/lib/storage.js'
import type { ThreadPageData, ShellInfo } from '../../server/lib/page-data-types.js'
import '../../components/caribou-app-shell.js'
import '../../components/caribou-auth-required.js'

export type StatusPageData = ThreadPageData & {
  shell: ShellInfo
  statusId: string
  handle: string
}

export const pageData = definePageData<StatusPageData>(async (event) => {
  const params = getRouterParams(event) as { handle?: string; statusId?: string }
  const handle = String(params.handle ?? '')
  // `statusId` is decoded from the URL path; the matcher's regex captures
  // the raw segment (which may be `encodeURIComponent`-encoded for ids
  // that contain `/`, `:`, etc. from non-Mastodon ActivityPub bridges).
  const statusId = decodeURIComponent(String(params.statusId ?? ''))

  // Status detail uses the cookie host (user's home instance) — NOT the
  // path host. Status ids are minted per-instance, and the id we have in
  // the URL came from a card the user saw in their home timeline, so the
  // home instance is the only one guaranteed to recognize this id. The
  // path's `@user@host` is for display + share-context.
  //
  // This is a deliberate departure from the spec's "host-qualified handle
  // uses path host directly" rule (§8.3 / §8.4). The spec assumed
  // Mastodon-on-Mastodon federation where origin-host could resolve the
  // id, but federation with Flipboard, Misskey, Pleroma, etc. (or even
  // any non-trivial id-mapping case) breaks that assumption. Following
  // Elk's `/{home-instance}/@{user}@{host}/{home-id}` model — Caribou
  // ties the home instance to the cookie instead of the URL.
  const cookieHost = await getInstance(event, { storage: getStorage() })
  const shell: ShellInfo = { instance: cookieHost ?? null }
  if (!cookieHost) {
    return { kind: 'auth-required', shell, statusId, handle } as StatusPageData
  }
  const [focusedR, contextR] = await Promise.allSettled([
    fetchStatus(statusId, { instance: cookieHost }),
    fetchThreadContext(statusId, { instance: cookieHost }),
  ])
  if (focusedR.status === 'rejected') {
    return { kind: 'error', message: String(focusedR.reason), shell, statusId, handle } as StatusPageData
  }
  const ancestors = contextR.status === 'fulfilled' ? contextR.value.ancestors : []
  const descendants = contextR.status === 'fulfilled' ? contextR.value.descendants : []
  // The server renders every card of the thread, so every status is cleaned
  // here. The fetcher never runs on the client; the dynamic import keeps the
  // jsdom-backed sanitizer out of the client bundle.
  const { sanitizeStatus } = await import('../../server/lib/sanitize.js')
  return {
    kind: 'ok',
    focused: sanitizeStatus(focusedR.value),
    ancestors: ancestors.map(sanitizeStatus),
    descendants: descendants.map(sanitizeStatus),
    shell, statusId, handle,
  } as StatusPageData
})

@customElement('page-handle-statusid')
export class HandleStatusPage extends LitroPage {
  static override styles = [pageReset, css`
    article { padding: 1rem; color: var(--fg-muted); }
  `]

  override render() {
    const data = (this.serverData ?? {
      kind: 'auth-required', shell: { instance: null }, statusId: '', handle: '',
    }) as StatusPageData
    const inst = data.shell.instance ?? ''
    if (data.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance=${inst}>
          <caribou-auth-required
            label="Threads by bare handle need to know which instance to query."
          ></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'error') {
      return html`
        <caribou-app-shell instance=${inst}>
          <article role="alert">
            Couldn't load status ${data.statusId}.
          </article>
        </caribou-app-shell>
      `
    }
    return html`<caribou-app-shell instance=${inst}></caribou-app-shell>`
  }
}

export default HandleStatusPage
