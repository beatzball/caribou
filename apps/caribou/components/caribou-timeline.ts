import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { mastodon } from 'masto'
import {
  activeClient, createTimelineStore, startPolling, type TimelineStore,
} from '@beatzball/caribou-state'
import {
  createIntersectionObserver, type CaribouIntersectionObserver,
} from '@beatzball/caribou-ui-headless'
import './caribou-status-card.js'
import './caribou-new-posts-banner.js'

export type TimelineKind = 'home' | 'local' | 'public'

export interface TimelineInitial {
  statuses: mastodon.v1.Status[]
  nextMaxId: string | null
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

@customElement('caribou-timeline')
export class CaribouTimeline extends LitElement {
  static override styles = css`
    :host { display: block; }
    ul { list-style: none; margin: 0; padding: 0; }
    .notice { padding: var(--space-4); color: var(--fg-muted); }
    [role="alert"] { padding: var(--space-4); color: var(--danger); }
    a[data-sentinel] {
      display: block; padding: var(--space-4);
      color: var(--fg-muted); text-align: center;
    }
  `

  @property({ reflect: true }) kind: TimelineKind = 'home'
  // The first page, fetched by the page's `pageData` on the server. The
  // server renders straight from it; the client seeds its store with it, so
  // the first client render equals the server render and no fetch runs.
  @property({ attribute: false }) initial: TimelineInitial | null = null

  @state() private statuses: mastodon.v1.Status[] = []
  @state() private loading = false
  @state() private errorMsg: string | null = null
  @state() private hasMore = true
  @state() private newPostsCount = 0
  // False while nobody is signed in on this device (browsing /local or
  // /public with the instance cookie only). The store then has no client
  // and cannot fetch a page in place.
  @state() private canFetch = false

  private store: TimelineStore | null = null
  private disposeBindings: (() => void) | null = null
  private stopPolling: (() => void) | null = null
  private io: CaribouIntersectionObserver | null = null
  private observedSentinel: Element | null = null
  private loadingOlder = false

  override connectedCallback() {
    super.connectedCallback()
    // Re-attach after a move in the DOM. On the first connect there is no
    // store yet — `willUpdate` makes it.
    if (this.store && !this.disposeBindings) {
      this.bind(this.store)
      this.requestUpdate()
    }
  }

  override disconnectedCallback() {
    this.disposeBindings?.()
    this.disposeBindings = null
    this.stopPolling?.()
    this.stopPolling = null
    this.io?.disconnect()
    this.observedSentinel = null
    super.disconnectedCallback()
  }

  protected override willUpdate() {
    // The store is made here and not in `connectedCallback`: while hydration
    // is deferred the element connects before its parent has set `initial`.
    // The server also runs `willUpdate`, and must not make a store — the
    // status cache behind it is a process-wide global. (`typeof window`, not
    // Lit's `isServer`, which is also true in the unit tests.)
    if (this.store || typeof window === 'undefined') return
    this.store = createTimelineStore(this.kind, {
      clientSource: () => activeClient.value,
      ...(this.initial ? { initial: this.initial } : {}),
    })
    this.bind(this.store)
    // The server already paid for the first page when `initial` is set.
    if (!this.initial) void this.store.load()
  }

  private bind(store: TimelineStore) {
    this.disposeBindings = effect(() => {
      // `statuses` in the store depends on the global status cache, which
      // gets a new Map on every write — including poll ticks that only add
      // statuses this timeline does not show yet. So the array is a new
      // reference on every poll. Keep the old array unless an element
      // really changed, so a quiet poll does not even re-render the list.
      const statuses = store.statuses.value
      if (!sameItems(statuses, this.statuses)) this.statuses = statuses
      this.loading = store.loading.value
      this.errorMsg = store.error.value?.message ?? null
      this.hasMore = store.hasMore.value
      this.newPostsCount = store.newPostsCount.value
      this.canFetch = activeClient.value !== null
    })
    if (this.kind === 'home') {
      this.stopPolling = startPolling({
        intervalMs: 30_000,
        fn: () => store.poll(),
      })
    }
  }

  protected override updated() {
    // The "Older posts" anchor is the no-JS pagination link. With JS and a
    // signed-in client it is also the infinite-scroll sentinel: when it
    // scrolls into view the next page loads in place. Without a client it
    // stays a plain link to the next server-rendered page — hijacking it
    // would fetch nothing, read that as the end of the timeline, and remove
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
    // timeline ends (the anchor is then no longer rendered).
    if (this.io && this.observedSentinel?.isConnected) {
      this.io.disconnect()
      this.io.observe(this.observedSentinel)
    }
  }

  private onSentinelClick = (e: Event) => {
    // In-place paging owns the anchor; otherwise let the browser follow it.
    if (this.canFetch) e.preventDefault()
  }

  private onApplyNewPosts = () => { this.store?.applyNewPosts() }

  override render() {
    // No store: this is the server. It renders from `initial` alone.
    const statuses = this.store ? this.statuses : (this.initial?.statuses ?? [])
    const hasMore = this.store ? this.hasMore : this.initial?.nextMaxId != null
    if (this.errorMsg) {
      return html`<div role="alert">${this.errorMsg}</div>`
    }
    if (this.loading && statuses.length === 0) {
      return html`<div class="notice">Loading your timeline…</div>`
    }
    const last = statuses[statuses.length - 1]
    if (!last) {
      return html`<div class="notice">No posts yet.</div>`
    }
    // Keyed by status id, and each card gets the status object itself. A
    // poll or a prepend therefore leaves every surviving card alone: same
    // key, same `.status` reference, no card update, no avatar re-fetch.
    //
    // The anchor href is query-only so the server (which has no location)
    // and the client render the same string; the browser resolves it
    // against the current path.
    return html`
      <div>
        <caribou-new-posts-banner
          .count=${this.newPostsCount}
          @apply-new-posts=${this.onApplyNewPosts}
        ></caribou-new-posts-banner>
        <ul>
          ${repeat(statuses, (s) => s.id, (s) => html`
            <li><caribou-status-card data-status-id=${s.id} .status=${s}></caribou-status-card></li>
          `)}
        </ul>
        ${hasMore
          ? html`<a href="?max_id=${encodeURIComponent(last.id)}" rel="next" data-sentinel
                    @click=${this.onSentinelClick}>Older posts →</a>`
          : nothing}
      </div>
    `
  }
}
