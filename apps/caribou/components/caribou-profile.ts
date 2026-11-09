import { LitElement, html, css, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import { canActOn, resourceNetwork, type Account, type CaribouClient, type Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUser, createAccountCache, createProfileStore,
  type ProfileStore, type ProfileTab,
} from '@beatzball/caribou-state'
import { createIntersectionObserver, type CaribouIntersectionObserver } from '@beatzball/caribou-ui-headless'
import { loadReaderViewFrom } from './_shell.js'
import './caribou-button.js'
import './caribou-profile-header.js'
import './caribou-profile-tabs.js'
import './caribou-status-card.js'

export interface ProfileInitial {
  account: Account
  statuses: Status[]
  /** Where the next page starts, as the server's page named it: opaque. */
  nextCursor: string | null
  tab: ProfileTab
}

// A remote account the reader's server has not seen yet: a search with
// `resolve` makes the server fetch it. Only an exact match counts. A failed
// search throws: that is a fault, not "not found".
async function resolveAccount(client: CaribouClient | null, handle: string): Promise<Account | null> {
  if (!client || !handle.includes('@')) return null
  const found = await client.search({ q: handle, type: 'accounts', resolve: true, limit: 1 })
  return found.accounts.find((a) => a.acct.toLowerCase() === handle.toLowerCase()) ?? null
}

function sameItems(a: readonly Status[], b: readonly Status[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

@customElement('caribou-profile')
export class CaribouProfile extends LitElement {
  static override styles = css`
    :host { display: block; }
    ul { list-style: none; margin: 0; padding: 0; }
    /* A card hidden by a filter, a mute or a block takes its row with it. */
    li:has(> caribou-status-card[hidden]) { display: none; }
    .loading, .missing, .failed { padding: var(--space-4); color: var(--fg-muted); }
    .missing, .failed p { margin: 0; }
    .missing a, .failed a { color: var(--accent); overflow-wrap: anywhere; }
    .failed caribou-button { margin-top: var(--space-2); }
    a[rel="next"] { display: block; padding: var(--space-4); color: var(--fg-muted); text-align: center; }
  `

  @property({ reflect: true }) handle = ''
  @property({ reflect: true }) tab: ProfileTab = 'posts'
  // The handle segment the links use, when it is not `handle`. On /@me the
  // account is looked up by the signed-in user's handle, but the tabs and the
  // next-page link must stay on /@me.
  @property({ attribute: 'link-handle' }) linkHandle = ''
  // The host the server fetched `initial` from. Account and status ids are
  // minted per instance, so the signed-in client can page this profile in
  // place only when it talks to that same host. Empty on /@me, where the
  // account is looked up through the client itself and the ids match.
  @property() instance = ''
  // The first page, fetched by the server. With it the element renders the
  // whole profile on the server and makes no request of its own on mount.
  // Without it (the /@me case) the element looks the account up through the
  // signed-in client.
  @property({ attribute: false }) initial: ProfileInitial | null = null

  // What the store holds. Until the store is wired — on the server, and in
  // the hydrating render, which must equal the server's — render() reads
  // `initial` instead.
  @state() private live = false
  @state() private account: Account | null = null
  @state() private statuses: Status[] = []
  @state() private hasMore = false
  // The store's cursor for the next page, which the next-page link carries.
  @state() private nextCursor: string | null = null
  // On /@me: the server of the session that looked the account up, which is
  // the host the account's ids belong to. Paging and the header's follow
  // button both need it after the reader switches to a session on another
  // server.
  @state() private accountServer = ''
  // False while nobody is signed in on this device (a reader who browses a
  // public profile), or while the signed-in client's server is not the
  // instance the page came from. In both cases the store cannot fetch a
  // valid page in place.
  @state() private canFetch = false
  // Whose decision a Bluesky account's moderation is: the reader whose
  // client looked it up, or null for the server's copy (README, "A decision
  // belongs to one reader").
  @state() private accountViewerOf: string | null = null
  // The reader's server found no account by this handle, by lookup or by
  // search: the profile is a message, never "Loading…" forever.
  @state() private missing = false
  // The reader's server could not answer the lookup (not a 404): a 500, a
  // network failure, or a failed search. The account can exist.
  @state() private failed = false

  private store: ProfileStore | null = null
  private dispose: (() => void) | null = null
  private io: CaribouIntersectionObserver | null = null
  private observedSentinel: Element | null = null
  private loadingOlder = false

  override connectedCallback() {
    super.connectedCallback()
    // Re-attach after a move in the DOM. On the first connect there is no
    // store yet — `firstUpdated` makes it.
    if (this.store && !this.dispose) {
      this.bind()
      this.requestUpdate()
    }
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    this.io?.disconnect()
    this.observedSentinel = null
    super.disconnectedCallback()
  }

  // The store is made here, not in connectedCallback: a server-rendered
  // element connects before its parent has hydrated and set `initial`, and
  // the server itself must never fill the module-level status cache.
  protected override firstUpdated() {
    void this.start()
  }

  private async start() {
    // Pages come only from a client on the profile's own network (spec
    // section 11); another network's client would ask for the wrong ids.
    const clientSource = () => {
      const client = activeClient.value
      const shown = this.account ?? this.initial?.account
      return !shown || canActOn(client, shown) ? client : null
    }
    let account: Account | null
    let store: ProfileStore | null = null
    if (this.initial) {
      account = this.initial.account
      store = createProfileStore(account.id, this.tab, {
        clientSource,
        initial: { statuses: this.initial.statuses, nextCursor: this.initial.nextCursor },
      })
      // The server fetched them without the reader's token: no filters.
      loadReaderViewFrom(this.instance, this.initial.statuses)
    } else {
      const server = activeUser.value?.server ?? ''
      const cache = createAccountCache(clientSource)
      this.accountViewerOf = clientSource()?.userKey ?? null
      const handle = this.handle.replace(/^@/, '')
      let failed = false
      const fault = () => { failed = true; return null }
      account = await cache.lookup(handle).catch(async (err: unknown) =>
        // Lookup knows only accounts the server has seen. A remote one it
        // has not seen is a 404; a search with `resolve` fetches it, as the
        // search page does. Any other error is a fault.
        (err as { code?: string }).code === 'not_found'
          ? resolveAccount(clientSource(), handle).catch(fault)
          : fault())
      this.accountServer = server
      if (failed) {
        this.failed = true
      } else if (account) {
        store = createProfileStore(account.id, this.tab, { clientSource })
        await store.load()
      } else if (clientSource()) {
        // Only a reader's server can say it found nothing; with no client
        // nothing was asked.
        this.missing = true
      }
    }
    if (!store) return
    this.account = account
    this.store = store
    if (this.isConnected) this.bind()
  }

  private bind() {
    const store = this.store!
    this.dispose = effect(() => {
      const next = store.statuses.value
      // The store derives `statuses` from the shared status cache, and every
      // write to that cache — for any timeline — replaces the Map. So this
      // runs with a new array of the same statuses far more often than the
      // list changes. Assigning it would re-render the whole profile.
      if (!sameItems(next, this.statuses)) this.statuses = next
      this.hasMore = store.hasMore.value
      this.nextCursor = store.nextCursor.value
      this.syncCanFetch()
    })
    this.live = true
  }

  private syncCanFetch() {
    const shown = this.account ?? this.initial?.account
    const network = shown ? resourceNetwork(shown) : 'mastodon'
    // A Bluesky profile has no server to match: a DID is the same for
    // every account.
    this.canFetch = activeClient.value?.capabilities.network === network
      && (network === 'bluesky' || this.sameInstance(activeUser.value?.server))
  }

  // Hosts are case-insensitive; `server` is a bare host, like `instance`.
  // On /@me there is no `instance`; the account's ids belong to the server
  // of the session that looked it up, and a session on another server must
  // not page them.
  private sameInstance(server: string | undefined): boolean {
    const host = this.instance || this.accountServer
    if (!host) return true
    return server !== undefined && server.toLowerCase() === host.toLowerCase()
  }

  // Untyped: `accountServer` is private, so it is not a key of `this`.
  protected override willUpdate(changed: PropertyValues) {
    // The effect in bind() recomputes `canFetch` when a signal changes, but
    // `instance` and `accountServer` are Lit fields, not signals. A new host
    // must have the same effect without waiting for the next sign-in or
    // sign-out.
    if ((changed.has('instance') || changed.has('accountServer')) && this.live) this.syncCanFetch()
  }

  protected override updated() {
    // The "Older posts" anchor is the no-JS pagination link. With JS and a
    // signed-in client it is also the infinite-scroll sentinel: when it
    // scrolls into view the next page loads in place. Without a client it
    // stays a plain link to the next server-rendered page — hijacking it
    // would fetch nothing, read that as the end of the profile, and remove
    // the only way to older posts. With a client on another instance it
    // stays a link too: the ids in `initial` mean nothing to that client,
    // so paging in place would show another account's posts or a 404.
    const sentinel = this.canFetch ? this.renderRoot.querySelector('a[data-sentinel]') : null
    if (sentinel === this.observedSentinel) return
    this.observedSentinel = sentinel
    this.io?.disconnect()
    if (!sentinel) return
    this.io ??= createIntersectionObserver(this.onSentinelIntersect)
    this.io.observe(sentinel)
  }

  private onSentinelIntersect = async (entry: IntersectionObserverEntry) => {
    // `canFetch` can turn false between a report and this handler, after a
    // switch to a session on another server: then the anchor is a link again.
    if (!entry.isIntersecting || this.loadingOlder || !this.canFetch) return
    this.loadingOlder = true
    try {
      await this.store?.loadMore()
      await this.updateComplete
    } finally {
      this.loadingOlder = false
    }
    // A short page can leave the anchor in view, and an observer reports a
    // target only when its state changes. Observe again to get a fresh
    // report and keep loading until the anchor leaves the viewport or the
    // profile ends (the anchor is then no longer rendered). Not after a
    // failed load: the profile shows no error state, so the anchor stays in
    // view and a fresh report would retry the failing request without end.
    if (this.store?.error.value) return
    if (this.io && this.observedSentinel?.isConnected) {
      this.io.disconnect()
      this.io.observe(this.observedSentinel)
    }
  }

  private onSentinelClick = (e: Event) => {
    // In-place paging owns the anchor; otherwise let the browser follow it.
    if (this.canFetch) e.preventDefault()
  }

  // A link to the account on its own server, when the handle names one.
  private renderOpenOnHost(handle: string) {
    const [name, host] = handle.split('@')
    return host
      ? html`<a href=${`https://${host}/@${encodeURIComponent(name ?? '')}`} rel="noopener noreferrer">Open it on ${host}</a>.`
      : nothing
  }

  // The handle, and a link to the account on its own server when it has one.
  private renderMissing() {
    const handle = this.handle.replace(/^@/, '')
    return html`<p class="missing" role="alert">
      Couldn't find @${handle} from your server.
      ${this.renderOpenOnHost(handle)}
    </p>`
  }

  private renderFailed() {
    const handle = this.handle.replace(/^@/, '')
    return html`<div class="failed"><p role="alert">
      Couldn't load @${handle} from your server.
      ${this.renderOpenOnHost(handle)}
    </p><caribou-button variant="secondary" data-action="retry" @click=${this.onRetry}>Retry</caribou-button></div>`
  }

  // Back to "Loading…", then ask again. A second failure puts the alert
  // back as a new node, so a screen reader announces it again.
  private onRetry = () => {
    this.failed = false
    void this.start()
  }

  override render() {
    const account = this.live ? this.account : (this.initial?.account ?? null)
    if (!account && this.failed) return this.renderFailed()
    if (!account && this.missing) return this.renderMissing()
    if (!account) return html`<div class="loading">Loading…</div>`
    const statuses = this.live ? this.statuses : (this.initial?.statuses ?? [])
    // The cursor is opaque: the link carries it as the page named it, never
    // the last post's id. The hydrating render reads `initial`, as the
    // server did, so both write the same link.
    const nextCursor = this.live ? this.nextCursor : (this.initial?.nextCursor ?? null)
    const hasMore = this.live ? this.hasMore : nextCursor != null
    const linkHandle = (this.linkHandle || this.handle).replace(/^@/, '')
    // An empty page can have more behind it: a list ends only on a null
    // cursor (README, "Bluesky views"). So the link does not wait for posts.
    const nextHref = hasMore && nextCursor != null
      ? `/@${linkHandle}?tab=${this.tab}&max_id=${encodeURIComponent(nextCursor)}`
      : null
    // `repeat` keys each row by status id, so a new page or a reordered list
    // moves the existing cards instead of rebuilding them — a card that is
    // rebuilt fetches its avatar again.
    //
    // The link sits inside `.posts`, not at the top level of the template:
    // happy-dom's parser drops a child binding that has no parent element,
    // and the component tests would never see the link.
    return html`
      <caribou-profile-header .account=${account} .viewerOf=${this.accountViewerOf} instance=${this.instance || this.accountServer}></caribou-profile-header>
      <caribou-profile-tabs handle=${linkHandle} tab=${this.tab}></caribou-profile-tabs>
      <div class="posts">
        <ul>
          ${repeat(statuses, (s) => s.id, (s) => html`<li
            ><caribou-status-card variant="timeline" data-status-id=${s.id} .status=${s}
              instance=${this.instance || this.accountServer} filter-context="account"></caribou-status-card
          ></li>`)}
        </ul>
        ${nextHref
          ? html`<a href=${nextHref} rel="next" data-sentinel @click=${this.onSentinelClick}>Older posts →</a>`
          : nothing}
      </div>
    `
  }
}
