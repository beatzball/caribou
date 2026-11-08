import { html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { activeClient } from '@beatzball/caribou-state'
import { LitroPage, pageReset, type LitroLocation } from '@beatzball/litro/runtime'
import { definePageData } from '@beatzball/litro'
import { getRouterParams, setResponseStatus } from 'h3'
import { getInstance } from '../../server/lib/instance-cookie.js'
import {
  fetchStatus, fetchThreadContext,
} from '../../server/lib/mastodon-public.js'
import { getStorage } from '../../server/lib/storage.js'
import type { ThreadPageData, ShellInfo } from '../../server/lib/page-data-types.js'
import '../../components/caribou-app-shell.js'
import '../../components/caribou-auth-required.js'
import '../../components/caribou-thread.js'
import { enterWithCache } from '../../components/_page-cache.js'
import {
  blueskyActor, blueskyPostUri, postRouteOf, rendersBluesky, replaceDidRoute, routeSegment,
} from '../../components/_bluesky-route.js'

// `not-found`: a Bluesky route whose DID, handle or record key is not well
// formed; nothing was fetched (README, "Bluesky SSR").
export type StatusPageData = (ThreadPageData | { kind: 'not-found' }) & {
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
  const shell: ShellInfo = cookieHost ? { instance: cookieHost, source: 'cookie' } : { instance: null }
  // A Bluesky post (spec 8.4 rule 5), behind the server flag. It needs no
  // instance: the public AppView answers for every post.
  const route = postRouteOf(handle, statusId)
  if (route.network === 'bluesky') {
    const bsky = await import('../../server/lib/bluesky-public.js')
    if (bsky.blueskySsrEnabled()) {
      if (!bsky.validActor(route.actor) || !bsky.validRecordKey(route.rkey)) {
        setResponseStatus(event, 404)
        return { kind: 'not-found', shell, statusId: '', handle: '' }
      }
      try {
        const thread = await bsky.fetchBlueskyThread(route.actor, route.rkey)
        // A hidden author's thread keeps no handle (spec 8.3): the client
        // reads the address instead.
        const shown = bsky.asksHidden(thread.focused.account) ? '' : handle
        return { kind: 'ok', ...thread, shell, statusId, handle: shown }
      } catch (err) {
        return { kind: 'error', message: String(err), shell, statusId, handle } as StatusPageData
      }
    }
  }
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

  // A Bluesky thread, rendered on the client (phase 2b; README, "Bluesky
  // views"): the focused post's AT URI. Set after the first render.
  @state() private blueskyUri: string | null = null

  protected override firstUpdated() {
    const data = this.serverData as StatusPageData | null
    // Opened by DID: show the handle form in the address bar (spec 8.4).
    if (data?.kind === 'ok' && data.focused.bluesky) {
      replaceDidRoute(window, data.handle, data.focused.account, `/${encodeURIComponent(data.statusId)}`)
    }
    const actor = blueskyActor(data?.handle || routeSegment(window.location.pathname))
    if (actor && data?.statusId && rendersBluesky(window, activeClient.value)) {
      this.blueskyUri = blueskyPostUri(actor, data.statusId)
    }
  }

  // A revisit paints from the last copy at once. The fresh thread that
  // follows updates the posts in place and adds new replies at the end
  // (`enterWithCache`, `ThreadStore.offer`).
  override onBeforeEnter(location: LitroLocation) {
    return enterWithCache(this, location, () => super.onBeforeEnter(location), {
      onFresh: (fresh) => { this.serverData = fresh },
    })
  }

  override render() {
    const data = (this.serverData ?? {
      kind: 'auth-required', shell: { instance: null }, statusId: '', handle: '',
    }) as StatusPageData
    const inst = data.shell.instance ?? ''
    if (this.blueskyUri) {
      return html`
        <caribou-app-shell instance=${inst}>
          <caribou-thread statusid=${this.blueskyUri}></caribou-thread>
        </caribou-app-shell>
      `
    }
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
    if (data.kind === 'not-found') {
      return html`
        <caribou-app-shell instance=${inst}>
          <article role="alert">There is no Bluesky post at this address.</article>
        </caribou-app-shell>
      `
    }
    // A Bluesky thread is keyed by the focused post's AT URI.
    const id = data.focused.bluesky ? data.focused.id : data.statusId
    return html`
      <caribou-app-shell instance=${inst}>
        <caribou-thread statusid=${id} .initial=${data}></caribou-thread>
      </caribou-app-shell>
    `
  }
}

export default HandleStatusPage
