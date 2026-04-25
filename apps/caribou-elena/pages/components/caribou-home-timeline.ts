import { Elena, html } from '@elenajs/core'
import { effect } from '@preact/signals-core'
import type { mastodon } from 'masto'
import {
  activeClient, createTimelineStore, startPolling, type TimelineStore,
} from '@beatzball/caribou-state'
import './caribou-status-card.js'
import './caribou-new-posts-banner.js'

export class CaribouHomeTimeline extends Elena(HTMLElement) {
  static override tagName = 'caribou-home-timeline'

  private store: TimelineStore | null = null
  private disposeBindings: (() => void) | null = null
  private disposeBannerBinding: (() => void) | null = null
  private stopPolling: (() => void) | null = null

  private statuses: mastodon.v1.Status[] = []
  private loading = false
  private errorMsg: string | null = null

  override connectedCallback() {
    super.connectedCallback?.()
    this.store = createTimelineStore('home', { clientSource: () => activeClient.value })
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
    void this.store.load()
    this.stopPolling = startPolling({
      intervalMs: 30_000,
      fn: () => this.store?.poll(),
    })
    this.addEventListener('apply-new-posts', () => this.store?.applyNewPosts())
  }

  override disconnectedCallback() {
    this.disposeBindings?.()
    this.disposeBannerBinding?.()
    this.stopPolling?.()
    super.disconnectedCallback?.()
  }

  override updated() {
    // Elena's template engine only interpolates plain `attr=`; it does
    // NOT wire `.prop=` bindings, so object/number props on child
    // components are assigned imperatively after each parent render.
    //
    // Elena's morph also recurses into the light DOM of custom-element
    // children (see @elenajs/core render.js `morphContent`). Our child
    // templates here (`<caribou-status-card>`, `<caribou-new-posts-banner>`)
    // are rendered empty from the parent's perspective, so any time this
    // component re-renders, morph strips whatever each child rendered for
    // itself. Assigning a changed prop repairs the child (Elena's setter
    // triggers `_safeRender`), but when the prop reference is stable —
    // cached status objects are the same map entries across polls — the
    // `===` short-circuit skips the re-render and the wiped inner DOM
    // stays wiped. Fall back to `requestUpdate()` when a child's light
    // DOM was emptied.
    //
    // Banner count is pushed by a dedicated effect in `connectedCallback`
    // so poll ticks don't trigger this component's render in the first
    // place; we only need to re-render the banner here if the timeline
    // re-rendered for an unrelated reason and morph wiped it.
    const banner = this.querySelector<HTMLElement & { requestUpdate?: () => void }>(
      'caribou-new-posts-banner',
    )
    if (banner && banner.children.length === 0) banner.requestUpdate?.()

    const cards = this.querySelectorAll<HTMLElement & { status?: mastodon.v1.Status | null; requestUpdate?: () => void }>(
      'caribou-status-card[data-index]',
    )
    cards.forEach((card) => {
      const idx = Number(card.dataset.index)
      const status = this.statuses[idx]
      if (!status) return
      if (card.status !== status) {
        card.status = status
      } else if (card.children.length === 0) {
        card.requestUpdate?.()
      }
    })
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
    return html`
      <div>
        <caribou-new-posts-banner></caribou-new-posts-banner>
        <ul style="list-style:none;margin:0;padding:0;">
          ${this.statuses.map((s, i) => html`
            <li>
              <caribou-status-card data-index=${i} data-status-id=${s.id}></caribou-status-card>
            </li>
          `)}
        </ul>
      </div>
    `
  }
}
CaribouHomeTimeline.define()
