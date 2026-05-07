import { Elena, html } from '@elenajs/core'
import { effect } from '@preact/signals-core'
import type { mastodon } from 'masto'
import {
  activeClient, createTimelineStore, startPolling, type TimelineStore,
} from '@beatzball/caribou-state'
import { createIntersectionObserver } from '@beatzball/caribou-ui-headless'
import './caribou-status-card.js'
import './caribou-new-posts-banner.js'

type TimelineKind = 'home' | 'local' | 'public'

export class CaribouTimeline extends Elena(HTMLElement) {
  static override tagName = 'caribou-timeline'
  static override props = [
    { name: 'kind',    reflect: true  },
    { name: 'initial', reflect: false },
  ]

  kind: TimelineKind = 'home'
  initial: { statuses: mastodon.v1.Status[]; nextMaxId: string | null } | null = null

  private store: TimelineStore | null = null
  private disposeBindings: (() => void) | null = null
  private disposeBannerBinding: (() => void) | null = null
  private stopPolling: (() => void) | null = null
  private io: { observe(el: Element): void; disconnect(): void } | null = null

  private statuses: mastodon.v1.Status[] = []
  private loading = false
  private errorMsg: string | null = null

  override connectedCallback() {
    super.connectedCallback?.()
    this.store = createTimelineStore(this.kind, {
      clientSource: () => activeClient.value,
      ...(this.initial ? { initial: this.initial } : {}),
    })
    // Drive THIS component's own render. newPostsCount is intentionally
    // not read here — it's pushed into the banner via a separate effect
    // below. Even so, the `statuses` computed in the store depends on
    // `statusCache`, and `cacheStatus()` creates a new Map reference on
    // every write (including poll ticks that add statuses *not* on this
    // timeline yet). That makes `statuses.value` a new array reference
    // on every poll, which would trigger a full timeline re-render + a
    // morph walk that wipes every status card's light DOM, which the
    // browser then re-fetches avatar images for. Shallow-compare the
    // statuses array so we only re-render when the displayed content
    // actually changed (length + element references).
    this.disposeBindings = effect(() => {
      const statuses = this.store!.statuses.value
      const loading  = this.store!.loading.value
      const errorMsg = this.store!.error.value?.message ?? null

      let changed =
        statuses.length !== this.statuses.length ||
        loading !== this.loading ||
        errorMsg !== this.errorMsg
      if (!changed) {
        for (let i = 0; i < statuses.length; i++) {
          if (statuses[i] !== this.statuses[i]) { changed = true; break }
        }
      }

      this.statuses = statuses
      this.loading = loading
      this.errorMsg = errorMsg

      if (changed) this.requestUpdate()
    })
    // Push newPostsCount imperatively into the banner so a poll that only
    // changes this signal does not invalidate the timeline's render.
    this.disposeBannerBinding = effect(() => {
      const count = this.store!.newPostsCount.value
      const banner = this.querySelector<HTMLElement & { count?: number }>(
        'caribou-new-posts-banner',
      )
      if (banner && banner.count !== count) banner.count = count
    })
    // SSR seeded the first page via `initial`, so skip the immediate fetch
    // — the store already has data and `firstLoadConsumed` set true.
    if (!this.initial) void this.store.load()
    if (this.kind === 'home') {
      this.stopPolling = startPolling({
        intervalMs: 30_000,
        fn: () => this.store?.poll(),
      })
    }
    this.addEventListener('apply-new-posts', () => this.store?.applyNewPosts())
  }

  override disconnectedCallback() {
    this.disposeBindings?.()
    this.disposeBannerBinding?.()
    this.stopPolling?.()
    this.io?.disconnect()
    super.disconnectedCallback?.()
  }

  override updated() {
    // Elena's template engine only interpolates plain `attr=`; it does
    // NOT wire `.prop=` bindings, so object/number props on child
    // components are assigned imperatively after each parent render.
    const banner = this.querySelector<HTMLElement & { requestUpdate?: () => void }>(
      'caribou-new-posts-banner',
    )
    if (banner && banner.children.length === 0) banner.requestUpdate?.()

    const cards = this.querySelectorAll<HTMLElement & { status?: mastodon.v1.Status | null }>(
      'caribou-status-card[data-index]',
    )
    cards.forEach((card) => {
      const idx = Number(card.dataset.index)
      const status = this.statuses[idx]
      if (status && card.status !== status) card.status = status
    })

    // Wire the IntersectionObserver sentinel on the "Older posts" anchor.
    // The anchor is the no-JS path's source-of-truth pagination link; with
    // JS active we hijack the click to call store.loadMore() and refresh
    // the anchor href to the next max_id. If hasMore goes false, remove
    // the anchor entirely so the user sees end-of-list.
    const sentinel = this.querySelector<HTMLAnchorElement>('a[data-sentinel]')
    if (sentinel && !this.io) {
      this.io = createIntersectionObserver(async (entry) => {
        if (!entry.isIntersecting) return
        sentinel.removeEventListener('click', this.onSentinelClick)
        sentinel.addEventListener('click', this.onSentinelClick)
        await this.store?.loadMore()
        this.refreshSentinel()
      })
      this.io.observe(sentinel)
    }
  }

  private onSentinelClick = (e: Event) => { e.preventDefault() }

  private refreshSentinel() {
    const sentinel = this.querySelector<HTMLAnchorElement>('a[data-sentinel]')
    if (!sentinel) return
    if (!this.store?.hasMore.value) {
      sentinel.remove()
      this.io?.disconnect()
      this.io = null
      return
    }
    const last = this.statuses[this.statuses.length - 1]
    if (!last) return
    const url = new URL(window.location.href)
    url.searchParams.set('max_id', last.id)
    sentinel.href = url.pathname + url.search
    this.io?.observe(sentinel)
  }

  override render() {
    if (this.errorMsg) {
      return html`
        <div role="alert" style="padding:var(--space-4);color:var(--danger);">
          ${this.errorMsg}
        </div>
      `
    }
    if (this.loading && this.statuses.length === 0) {
      return html`<div style="padding:var(--space-4);color:var(--fg-muted);">Loading your timeline…</div>`
    }
    if (this.statuses.length === 0) {
      return html`<div style="padding:var(--space-4);color:var(--fg-muted);">No posts yet.</div>`
    }
    const last = this.statuses[this.statuses.length - 1]
    const nextHref = last ? this.buildNextHref(last.id) : null
    return html`
      <div>
        <caribou-new-posts-banner></caribou-new-posts-banner>
        <ul style="list-style:none;margin:0;padding:0;">
          ${this.statuses.map((s, i) => html`
            <li>
              <caribou-status-card data-index="${i}" data-status-id="${s.id}"></caribou-status-card>
            </li>
          `)}
        </ul>
        ${nextHref
          ? html`<a href="${nextHref}" rel="next" data-sentinel
                   style="display:block;padding:var(--space-4);color:var(--fg-muted);text-align:center;">Older posts →</a>`
          : html``}
      </div>
    `
  }

  private buildNextHref(lastId: string): string {
    if (typeof window === 'undefined') return `?max_id=${lastId}`
    const url = new URL(window.location.href)
    url.searchParams.set('max_id', lastId)
    return url.pathname + url.search
  }
}
CaribouTimeline.define()
