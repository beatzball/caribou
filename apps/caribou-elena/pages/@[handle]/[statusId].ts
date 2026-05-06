import { html } from '@elenajs/core'
import { LitroPage } from '@beatzball/litro/adapter/elena/page'
import { definePageData } from '@beatzball/litro'
import { getRequestURL, getRouterParams } from 'h3'
import { getInstance } from '../../server/lib/instance-cookie.js'
import {
  fetchStatus, fetchThreadContext,
} from '../../server/lib/mastodon-public.js'
import { getStorage } from '../../server/lib/storage.js'
import type { ThreadPageData, ShellInfo } from '../../server/lib/page-data-types.js'
import '../components/caribou-app-shell.js'
import '../components/caribou-thread.js'
import '../components/caribou-auth-required.js'

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
  const origin = getRequestURL(event).origin
  const cookieHost = await getInstance(event, { storage: getStorage(), origin })
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
  return {
    kind: 'ok',
    focused: focusedR.value, ancestors, descendants,
    shell, statusId, handle,
  } as StatusPageData
})

export default class HandleStatusPage extends LitroPage {
  // Must match Litro's manifest-derived tag for `pages/@[handle]/[statusId].ts`:
  // bracket params lowercase verbatim, so `[statusId]` → `statusid` (not `status`).
  static override tagName = 'page-handle-statusid'

  override updated() {
    const data = this.serverData as StatusPageData | null
    if (!data || data.kind !== 'ok') return
    const thread = this.querySelector<HTMLElement & { initial?: unknown }>('caribou-thread')
    if (!thread || thread.initial !== undefined) return
    thread.initial = {
      focused: data.focused,
      ancestors: data.ancestors,
      descendants: data.descendants,
    }
  }

  override render() {
    const data = (this.serverData ?? {
      kind: 'auth-required', shell: { instance: null }, statusId: '', handle: '',
    }) as StatusPageData
    const inst = data.shell.instance ?? ''
    if (data.kind === 'auth-required') {
      return html`
        <caribou-app-shell instance="${inst}">
          <caribou-auth-required
            label="Threads by bare handle need to know which instance to query."
          ></caribou-auth-required>
        </caribou-app-shell>
      `
    }
    if (data.kind === 'error') {
      return html`
        <caribou-app-shell instance="${inst}">
          <article class="p-4 fg-muted" role="alert">
            Couldn't load status ${data.statusId}.
          </article>
        </caribou-app-shell>
      `
    }
    return html`
      <caribou-app-shell instance="${inst}">
        <caribou-thread status-id="${data.statusId}"></caribou-thread>
      </caribou-app-shell>
    `
  }
}
HandleStatusPage.define()
