import { LitElement, html, css, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { mastodon } from 'masto'
import {
  activeClient, createKeepAlive, createTimelineStore, normalizeTagName, startPolling, type TimelineStore,
} from '@beatzball/caribou-state'
import {
  createIntersectionObserver, type CaribouIntersectionObserver,
} from '@beatzball/caribou-ui-headless'
import './caribou-status-card.js'
import './caribou-new-posts-banner.js'
import './caribou-button.js'
import { STALE_MS, isCachedSnapshot, trackUpdate } from './_page-cache.js'
import { timelineFilterContext } from './_status-filter.js'
import { findShell, loadReaderViewFrom } from './_shell.js'

export type TimelineKind = 'home' | 'local' | 'public' | 'bookmarks' | 'hashtag'

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

// The stores of the timelines the reader saw last, so coming back to one
// shows its posts at once instead of fetching them again. The keep-alive
// empties itself when the active account changes.
const stores = createKeepAlive<TimelineStore>(12)

// On a full page load the router mounts the page twice (README); the second
// mount must not refetch what the first one has just loaded. The outlet is
// marked settled only once that first swap is done.
const firstLoadSettling = () => !document.querySelector('litro-outlet[data-litro-settled]')

// Only the first page of a timeline is kept. `?max_id=` is an older page,
// reached by the no-JS "Older posts" link; kept under the timeline's name it
// would become the list the next visit shows.
const isFirstPage = () => !new URLSearchParams(location.search).has('max_id')

// The timelines that are kept. Bookmarks are not, yet: their pages run by a
// bookmark cursor, and a `since_id` check by status id does not fit them.
const KEPT: ReadonlySet<TimelineKind> = new Set(['home', 'local', 'public', 'hashtag'])

@customElement('caribou-timeline')
export class CaribouTimeline extends LitElement {
  static override styles = css`
    :host { display: block; }
    ul { list-style: none; margin: 0; padding: 0; }
    /* A card hidden by a filter, a mute or a block takes its row with it. */
    li:has(> caribou-status-card[hidden]) { display: none; }
    .notice { padding: var(--space-4); color: var(--fg-muted); }
    [role="alert"] { padding: var(--space-4); color: var(--danger); }
    .failed { display: flex; align-items: center; gap: var(--space-2); padding-inline-end: var(--space-4); }
    .failed [role="alert"] { flex: 1; }
    a[data-sentinel] {
      display: block; padding: var(--space-4);
      color: var(--fg-muted); text-align: center;
    }
  `

  @property({ reflect: true }) kind: TimelineKind = 'home'
  // The hashtag, for `kind="hashtag"`. Set once: the router makes a new
  // page, and so a new timeline, for every tag.
  @property({ reflect: true }) tag = ''
  // The first page, fetched by the page's `pageData` on the server. The
  // server renders straight from it; the client seeds its store with it, so
  // the first client render equals the server render and no fetch runs.
  @property({ attribute: false }) initial: TimelineInitial | null = null

  @state() private statuses: mastodon.v1.Status[] = []
  @state() private loading = false
  @state() private errorMsg: string | null = null
  // A failed older page shows at the bottom, where the reader is looking.
  @state() private failedOlder = false
  @state() private hasMore = true
  @state() private newPostsCount = 0
  // False while nobody is signed in on this device (browsing /local or
  // /public with the instance cookie only). The store then has no client
  // and cannot fetch a page in place.
  @state() private canFetch = false
  // Set while a Retry runs. The store clears its error as the retry starts;
  // the failed block stays in place with a busy button until it is done, so
  // the button the reader pressed keeps focus (#108). `older` says where the
  // block was, since the store no longer does.
  @state() private retrying: { older: boolean } | null = null

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

  protected override willUpdate(changed: PropertyValues<this>) {
    // The store is made here and not in `connectedCallback`: while hydration
    // is deferred the element connects before its parent has set `initial`.
    // The server also runs `willUpdate`, and must not make a store — the
    // status cache behind it is a process-wide global. (`typeof window`, not
    // Lit's `isServer`, which is also true in the unit tests.)
    if (typeof window === 'undefined') return
    if (this.store) {
      // The page got fresh data in the background (`enterWithCache`).
      if (changed.has('initial') && this.initial && !isCachedSnapshot(this.initial)) {
        this.store.offer(this.initial.statuses, this.initial.nextMaxId)
        this.loadReaderView(this.initial.statuses)
      }
      return
    }
    const keep = KEPT.has(this.kind) && isFirstPage()
    // One kept store per tag; `#AI` and `#ai` are one tag.
    const keepKey = this.kind === 'hashtag' ? `hashtag:${normalizeTagName(this.tag)}` : this.kind
    const kept = keep ? stores.get(keepKey) : undefined
    if (kept) {
      this.store = kept
      this.bind(kept)
      const old = Date.now() - kept.syncedAt.peek() > STALE_MS
      // The list is already there; what is new goes to the banner. A cached
      // snapshot is what the store was filled from, so it adds nothing.
      if (this.initial && !isCachedSnapshot(this.initial)) {
        kept.offer(this.initial.statuses, this.initial.nextMaxId)
        this.loadReaderView(this.initial.statuses)
      }
      if (activeClient.peek() && !firstLoadSettling()) {
        const refresh = kept.refresh()
        if (old) trackUpdate(refresh)
      }
      return
    }
    const storeKind = this.kind === 'hashtag' ? { type: 'hashtag' as const, tag: this.tag } : this.kind
    this.store = createTimelineStore(storeKind, {
      clientSource: () => activeClient.value,
      ...(this.initial ? { initial: this.initial } : {}),
    })
    if (keep) stores.set(keepKey, this.store)
    this.bind(this.store)
    // The server already paid for the first page when `initial` is set.
    if (!this.initial) void this.store.load()
    else this.loadReaderView(this.initial.statuses)
  }

  // The server fetched `initial` without the reader's token, so it has none
  // of the reader's filters; ask again for the reader's copy.
  private loadReaderView(statuses: readonly mastodon.v1.Status[]) {
    loadReaderViewFrom(findShell(this)?.getAttribute('instance') ?? '', statuses)
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
      this.failedOlder = store.failedOp.value === 'loadMore'
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
    //
    // After a failed page it waits: a fresh report for an anchor still in
    // view would fail again at once, and again. Retry starts it again. (A
    // failed page shows in place of the anchor, so there is none to find.)
    // A failed background check at the top does not stop paging: the
    // anchor stays a working way to older posts.
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
    if (this.io && this.observedSentinel?.isConnected && this.store?.failedOp.peek() !== 'loadMore') {
      this.io.disconnect()
      this.io.observe(this.observedSentinel)
    }
  }

  private onSentinelClick = (e: Event) => {
    // In-place paging owns the anchor; otherwise let the browser follow it.
    if (this.canFetch) e.preventDefault()
  }

  private onApplyNewPosts = () => { this.store?.applyNewPosts() }

  private onRetry = async (e: Event) => {
    const store = this.store
    if (!store || this.retrying || this.errorMsg === null) return
    const button = e.currentTarget as HTMLElement
    const hadFocus = this.shadowRoot?.activeElement === button
    const older = this.failedOlder
    const before = this.statuses.length
    this.retrying = { older }
    try {
      await store.retry()
    } finally {
      this.retrying = null
    }
    await this.updateComplete
    // Failed again: the same button is still there, and still focused.
    if (!hadFocus || button.isConnected) return
    // It worked and the button is gone. Focus must not fall to the page.
    // A check at the top that found posts: the button that shows them.
    if (!older && this.newPostsCount > 0) {
      const banner = this.renderRoot.querySelector<LitElement>('caribou-new-posts-banner')
      await banner?.updateComplete
      const show = banner?.shadowRoot?.querySelector('button')
      if (show) {
        show.focus()
        return
      }
    }
    // Else, after an older page, the first post that came in (or the last
    // one, when the page was empty); else the top of the list.
    const list = this.renderRoot.querySelector('ul')
    const items = list?.children
    const target = (older ? items?.[before] ?? items?.[before - 1] : null)
      ?? list ?? this.renderRoot.querySelector<HTMLElement>('.notice')
    if (!(target instanceof HTMLElement)) return
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    target.focus()
  }

  override render() {
    // No store: this is the server. It renders from `initial` alone.
    const statuses = this.store ? this.statuses : (this.initial?.statuses ?? [])
    const hasMore = this.store ? this.hasMore : this.initial?.nextMaxId != null
    // A failed background check must not hide the list the reader has; it
    // shows above it until a later check works.
    const failed = this.errorMsg !== null || this.retrying !== null
    const failedOlder = this.retrying ? this.retrying.older : this.failedOlder
    if (failed && statuses.length === 0) return this.renderFailed()
    if (this.loading && statuses.length === 0) {
      return html`<div class="notice">${this.kind === 'bookmarks' ? 'Loading your bookmarks…' : 'Loading your timeline…'}</div>`
    }
    const last = statuses[statuses.length - 1]
    const context = timelineFilterContext(this.kind) ?? ''
    if (!last) {
      const empty = this.kind === 'bookmarks' ? 'No bookmarks yet.'
        : this.kind === 'hashtag' ? `No posts with #${this.tag} yet.` : 'No posts yet.'
      return html`<div class="notice">${empty}</div>`
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
        ${failed && !failedOlder ? this.renderFailed() : nothing}
        <caribou-new-posts-banner
          .count=${this.newPostsCount}
          @apply-new-posts=${this.onApplyNewPosts}
        ></caribou-new-posts-banner>
        <ul>
          ${repeat(statuses, (s) => s.id, (s) => html`
            <li><caribou-status-card data-status-id=${s.id} .status=${s}
              filter-context=${context}></caribou-status-card></li>
          `)}
        </ul>
        ${failed && failedOlder
          ? this.renderFailed()
          : hasMore
          ? html`<a href="?max_id=${encodeURIComponent(last.id)}" rel="next" data-sentinel
                    @click=${this.onSentinelClick}>Older posts →</a>`
          : nothing}
      </div>
    `
  }

  private renderFailed() {
    // The alert is empty while a Retry runs. A retry that fails again then
    // puts the message back as new text, and a screen reader announces it
    // again; the same text left in place would be silent.
    return html`<div class="failed"><div role="alert">${this.retrying ? '' : this.errorMsg}</div>
      <caribou-button variant="secondary" data-action="retry" ?loading=${this.retrying !== null}
        @click=${this.onRetry}>Retry</caribou-button></div>`
  }
}
