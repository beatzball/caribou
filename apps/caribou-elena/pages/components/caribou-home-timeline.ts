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

  override render() {
    if (this.errorMsg) {
      return html`
        <div role="alert" style="padding:var(--space-4);color:var(--danger);">
          ${this.errorMsg}
        </div>
      `
    }
    if (this.loading && this.statuses.length === 0) {
      return html`<p style="padding:var(--space-4);color:var(--fg-muted);">Loading your timeline…</p>`
    }
    if (this.statuses.length === 0) {
      return html`<p style="padding:var(--space-4);color:var(--fg-muted);">No posts yet.</p>`
    }
    return html`
      <caribou-new-posts-banner .count=${this.newCount}></caribou-new-posts-banner>
      <ul style="list-style:none;margin:0;padding:0;">
        ${this.statuses.map((s) => html`
          <li>
            <caribou-status-card .status=${s}></caribou-status-card>
          </li>
        `)}
      </ul>
    `
  }
}
CaribouHomeTimeline.define()
