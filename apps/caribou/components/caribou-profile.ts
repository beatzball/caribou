import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, createAccountCache, createProfileStore,
  type ProfileStore, type ProfileTab,
} from '@beatzball/caribou-state'
import { createIntersectionObserver, type CaribouIntersectionObserver } from '@beatzball/caribou-ui-headless'
import './caribou-profile-header.js'
import './caribou-profile-tabs.js'
import './caribou-status-card.js'

export interface ProfileInitial {
  account: Account
  statuses: Status[]
  nextMaxId: string | null
  tab: ProfileTab
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
    .loading { padding: var(--space-4); color: var(--fg-muted); }
    a[rel="next"] { display: block; padding: var(--space-4); color: var(--fg-muted); text-align: center; }
  `

  @property({ reflect: true }) handle = ''
  @property({ reflect: true }) tab: ProfileTab = 'posts'
  // The handle segment the links use, when it is not `handle`. On /@me the
  // account is looked up by the signed-in user's handle, but the tabs and the
  // next-page link must stay on /@me.
  @property({ attribute: 'link-handle' }) linkHandle = ''
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
  // False while nobody is signed in on this device (a reader who browses a
  // public profile). The store then has no client and cannot fetch a page
  // in place.
  @state() private canFetch = false

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
    const clientSource = () => activeClient.value
    let account: Account | null
    let store: ProfileStore | null = null
    if (this.initial) {
      account = this.initial.account
      store = createProfileStore(account.id, this.tab, {
        clientSource,
        initial: { statuses: this.initial.statuses, nextMaxId: this.initial.nextMaxId },
      })
    } else {
      const cache = createAccountCache(clientSource)
      account = await cache.lookup(this.handle.replace(/^@/, ''))
      if (account) {
        store = createProfileStore(account.id, this.tab, { clientSource })
        await store.load()
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
      this.canFetch = activeClient.value !== null
    })
    this.live = true
  }

  protected override updated() {
    // The "Older posts" anchor is the no-JS pagination link. With JS and a
    // signed-in client it is also the infinite-scroll sentinel: when it
    // scrolls into view the next page loads in place. Without a client it
    // stays a plain link to the next server-rendered page — hijacking it
    // would fetch nothing, read that as the end of the profile, and remove
    // the only way to older posts.
    const sentinel = this.canFetch ? this.renderRoot.querySelector('a[data-sentinel]') : null
    if (sentinel === this.observedSentinel) return
    this.observedSentinel = sentinel
    this.io?.disconnect()
    if (!sentinel) return
    this.io ??= createIntersectionObserver(this.onSentinelIntersect)
    this.io.observe(sentinel)
  }

  private onSentinelIntersect = async (entry: IntersectionObserverEntry) => {
    if (!entry.isIntersecting || this.loadingOlder) return
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

  override render() {
    const account = this.live ? this.account : (this.initial?.account ?? null)
    if (!account) return html`<div class="loading">Loading…</div>`
    const statuses = this.live ? this.statuses : (this.initial?.statuses ?? [])
    const hasMore = this.live ? this.hasMore : this.initial?.nextMaxId != null
    const last = statuses[statuses.length - 1]
    const linkHandle = (this.linkHandle || this.handle).replace(/^@/, '')
    const nextHref = last && hasMore ? `/@${linkHandle}?tab=${this.tab}&max_id=${last.id}` : null
    // `repeat` keys each row by status id, so a new page or a reordered list
    // moves the existing cards instead of rebuilding them — a card that is
    // rebuilt fetches its avatar again.
    //
    // The link sits inside `.posts`, not at the top level of the template:
    // happy-dom's parser drops a child binding that has no parent element,
    // and the component tests would never see the link.
    return html`
      <caribou-profile-header .account=${account}></caribou-profile-header>
      <caribou-profile-tabs handle=${linkHandle} tab=${this.tab}></caribou-profile-tabs>
      <div class="posts">
        <ul>
          ${repeat(statuses, (s) => s.id, (s) => html`<li
            ><caribou-status-card variant="timeline" data-status-id=${s.id} .status=${s}></caribou-status-card
          ></li>`)}
        </ul>
        ${nextHref
          ? html`<a href=${nextHref} rel="next" data-sentinel @click=${this.onSentinelClick}>Older posts →</a>`
          : nothing}
      </div>
    `
  }
}
