import { Elena, html } from '@elenajs/core'
import type { mastodon } from 'masto'
import {
  activeClient, bindSignals, createTimelineStore, startPolling, type TimelineStore,
} from '@beatzball/caribou-state'
import './caribou-status-card.js'
import './caribou-new-posts-banner.js'

export class CaribouHomeTimeline extends Elena(HTMLElement) {
  static override tagName = 'caribou-home-timeline'

  private store: TimelineStore | null = null
  private disposeBindings: (() => void) | null = null
  private stopPolling: (() => void) | null = null

  private statuses: mastodon.v1.Status[] = []
  private newCount = 0
  private loading = false
  private errorMsg: string | null = null

  override connectedCallback() {
    super.connectedCallback?.()
    this.store = createTimelineStore('home', { clientSource: () => activeClient.value })
    this.disposeBindings = bindSignals(this, () => {
      this.statuses  = this.store!.statuses.value
      this.newCount  = this.store!.newPostsCount.value
      this.loading   = this.store!.loading.value
      this.errorMsg  = this.store!.error.value?.message ?? null
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
    this.stopPolling?.()
    super.disconnectedCallback?.()
  }

  override updated() {
    // Elena's template engine only interpolates plain `attr=`. It does
    // NOT wire `.prop=` bindings, so we assign object/number props on
    // child components imperatively after each render. Guard each
    // assignment against re-setting the same object/number — setting a
    // reactive prop triggers a child re-render, and the child's own
    // `updated()` rewrites its `.status-content` innerHTML, producing
    // a brief DOM mutation storm that Playwright's `toBeVisible` can
    // transiently observe as "more than one match" under strict mode.
    const banner = this.querySelector<HTMLElement & { count?: number }>(
      'caribou-new-posts-banner',
    )
    if (banner && banner.count !== this.newCount) banner.count = this.newCount

    const cards = this.querySelectorAll<HTMLElement & { status?: mastodon.v1.Status | null }>(
      'caribou-status-card[data-index]',
    )
    cards.forEach((card) => {
      const idx = Number(card.dataset.index)
      const status = this.statuses[idx]
      if (status && card.status !== status) card.status = status
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
