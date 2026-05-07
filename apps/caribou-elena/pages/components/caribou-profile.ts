import { Elena, html } from '@elenajs/core'
import { effect } from '@preact/signals-core'
import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, createAccountCache, createProfileStore,
  type ProfileStore, type ProfileTab,
} from '@beatzball/caribou-state'
import { createIntersectionObserver } from '@beatzball/caribou-ui-headless'
import './caribou-profile-header.js'
import './caribou-profile-tabs.js'
import './caribou-status-card.js'

interface ProfileInitial {
  account: Account
  statuses: Status[]
  nextMaxId: string | null
  tab: ProfileTab
}

export class CaribouProfile extends Elena(HTMLElement) {
  static override tagName = 'caribou-profile'
  static override props = [
    { name: 'handle',  reflect: true  },
    { name: 'tab',     reflect: true  },
    { name: 'initial', reflect: false },
  ]
  handle: string = ''
  tab: ProfileTab = 'posts'
  initial: ProfileInitial | null = null

  private account: Account | null = null
  private store: ProfileStore | null = null
  private dispose: (() => void) | null = null
  private statuses: Status[] = []
  private io: { observe(el: Element): void; disconnect(): void } | null = null

  override async connectedCallback() {
    super.connectedCallback?.()
    if (this.initial) {
      this.account = this.initial.account
      this.store = createProfileStore(this.account.id, this.tab, {
        clientSource: () => activeClient.value,
        initial: { statuses: this.initial.statuses, nextMaxId: this.initial.nextMaxId },
      })
    } else {
      const cache = createAccountCache(() => activeClient.value)
      this.account = await cache.lookup(this.handle.replace(/^@/, ''))
      if (this.account) {
        this.store = createProfileStore(this.account.id, this.tab, {
          clientSource: () => activeClient.value,
        })
        await this.store.load()
      }
    }
    if (!this.store) { this.requestUpdate(); return }
    this.dispose = effect(() => {
      const next = this.store!.statuses.value
      let changed = next.length !== this.statuses.length
      if (!changed) {
        for (let i = 0; i < next.length; i++) {
          if (next[i] !== this.statuses[i]) { changed = true; break }
        }
      }
      this.statuses = next
      if (changed) this.requestUpdate()
    })
    this.requestUpdate()
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.io?.disconnect()
    super.disconnectedCallback?.()
  }

  override updated() {
    // Elena's template engine only interpolates plain `attr=`; object props
    // on child components must be assigned imperatively. Mirrors timeline.
    const header = this.querySelector<HTMLElement & { account?: Account | null }>(
      'caribou-profile-header',
    )
    if (header && header.account !== this.account) header.account = this.account

    const cards = this.querySelectorAll<HTMLElement & { status?: Status | null }>(
      'caribou-status-card[data-index]',
    )
    cards.forEach((card) => {
      const idx = Number(card.dataset.index)
      const status = this.statuses[idx]
      if (status && card.status !== status) card.status = status
    })

    const sentinel = this.querySelector<HTMLAnchorElement>('a[data-sentinel]')
    if (sentinel && !this.io) {
      this.io = createIntersectionObserver(async (e) => {
        if (!e.isIntersecting) return
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
    sentinel.href = this.buildNextHref(last.id)
    this.io?.observe(sentinel)
  }

  override render() {
    if (!this.account) {
      return html`<div style="padding:var(--space-4);color:var(--fg-muted);">Loading…</div>`
    }
    const last = this.statuses[this.statuses.length - 1]
    const nextHref = last && this.store?.hasMore.value
      ? this.buildNextHref(last.id)
      : null
    return html`
      <caribou-profile-header></caribou-profile-header>
      <caribou-profile-tabs handle="${this.handle}" tab="${this.tab}"></caribou-profile-tabs>
      <ul style="list-style:none;margin:0;padding:0;">
        ${this.statuses.map((s, i) => html`
          <li>
            <caribou-status-card data-index="${i}" data-status-id="${s.id}" variant="timeline"></caribou-status-card>
          </li>
        `)}
      </ul>
      ${nextHref
        ? html`<a href="${nextHref}" rel="next" data-sentinel
                 style="display:block;padding:var(--space-4);color:var(--fg-muted);text-align:center;">Older posts →</a>`
        : html``}
    `
  }

  private buildNextHref(lastId: string): string {
    const path = typeof window !== 'undefined' ? window.location.pathname : `/${this.handle}`
    return `${path}?tab=${this.tab}&max_id=${lastId}`
  }
}
CaribouProfile.define()
