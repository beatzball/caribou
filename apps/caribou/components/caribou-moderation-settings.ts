import { LitElement, html, css, nothing } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { mastodon } from 'masto'
import type { AccountPage, CaribouClient } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUser, relationshipCache, relationshipKey, setBlock, setMute,
} from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'
import { profilePath } from './_profile-path.js'
import { spaClick } from './_spa-link.js'
import './caribou-button.js'

type Account = mastodon.v1.Account
type Filter = mastodon.v2.Filter

interface AccountList {
  items: Account[]
  nextMaxId: string | null
  loading: boolean
  error: boolean
}

type FilterList =
  | { status: 'loading' }
  | { status: 'ready'; items: Filter[] }
  | { status: 'unsupported' }
  | { status: 'error' }

const CONTEXT_NAMES: Record<string, string> = {
  home: 'Home and lists', notifications: 'Notifications', public: 'Public timelines',
  thread: 'Conversations', account: 'Profiles',
}

const emptyList = (): AccountList => ({ items: [], nextMaxId: null, loading: true, error: false })

type Kind = 'mutes' | 'blocks'

const KINDS: Record<Kind, {
  heading: string; empty: string; on: string; off: string
  flag: 'muting' | 'blocking'
  fetch: (c: CaribouClient, maxId?: string) => Promise<AccountPage>
  write: (a: Account, on: boolean) => Promise<boolean>
}> = {
  mutes: {
    heading: 'Muted accounts', empty: 'You have not muted anyone.', on: 'Mute', off: 'Unmute', flag: 'muting',
    fetch: (c, maxId) => c.fetchMutes(maxId ? { maxId } : {}),
    write: (a, on) => setMute(a, on),
  },
  blocks: {
    heading: 'Blocked accounts', empty: 'You have not blocked anyone.', on: 'Block', off: 'Unblock', flag: 'blocking',
    fetch: (c, maxId) => c.fetchBlocks(maxId ? { maxId } : {}),
    write: (a, on) => setBlock(a, on),
  },
}

// The reader's server filters (read only: the server's own pages edit
// them), and the accounts the reader mutes and blocks, with Unmute and
// Unblock. A row stays after Unmute, its button turned to Mute, so a
// mistaken click can be undone in place; the next visit no longer lists it.
//
// Client only: the lists need the access token. The page renders this
// element after mount.
@customElement('caribou-moderation-settings')
export class CaribouModerationSettings extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; padding: var(--space-4); }
    h1 { font-size: 1.5rem; margin: 0 0 var(--space-4); }
    h2 { font-size: 1.125rem; margin: var(--space-6, 2rem) 0 var(--space-2); }
    section:first-of-type h2 { margin-top: 0; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { border-bottom: 1px solid var(--border); padding: var(--space-3) 0; }
    .notice { color: var(--fg-muted); margin: var(--space-2) 0; }
    [role="alert"] { color: var(--danger); margin: var(--space-2) 0; }
    a { color: var(--accent); }
    .filter h3 { font-size: 1rem; margin: 0; color: var(--fg-0); }
    .filter p { margin: var(--space-1) 0 0; color: var(--fg-1); }
    .filter .meta { color: var(--fg-muted); font-size: 0.875rem; }
    .account { display: flex; align-items: center; gap: var(--space-3); }
    .account img { border-radius: var(--radius-md); flex-shrink: 0; }
    .who {
      flex: 1; min-width: 0; display: flex; flex-direction: column;
      color: inherit; text-decoration: none; overflow-wrap: anywhere;
    }
    .who:hover strong { text-decoration: underline; }
    .who:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .who strong { color: var(--fg-0); }
    .who span { color: var(--fg-muted); }
    .more { margin-top: var(--space-3); }
    /* Read, not shown: the button names the account it acts on. */
    .vh {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
  `]

  @state() private filters: FilterList = { status: 'loading' }
  @state() private lists: Record<Kind, AccountList> = { mutes: emptyList(), blocks: emptyList() }
  @state() private server = ''
  // Changes on every relationship write, so the buttons follow the cache.
  @state() private relRevision = 0

  private dispose: (() => void) | null = null
  private loadedFor: CaribouClient | null = null

  override connectedCallback() {
    super.connectedCallback()
    this.dispose = effect(() => {
      const client = activeClient.value
      void relationshipCache.value
      this.relRevision++
      this.server = activeUser.value?.server ?? ''
      if (client && client !== this.loadedFor) {
        this.loadedFor = client
        void this.load(client)
      }
    })
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    super.disconnectedCallback()
  }

  private async load(client: CaribouClient) {
    this.filters = { status: 'loading' }
    this.lists = { mutes: emptyList(), blocks: emptyList() }
    await Promise.all([this.loadFilters(client), this.loadPage(client, 'mutes'), this.loadPage(client, 'blocks')])
  }

  private async loadFilters(client: CaribouClient) {
    try {
      const items = await client.fetchFilters()
      if (client === this.loadedFor) this.filters = { status: 'ready', items }
    } catch (err) {
      if (client !== this.loadedFor) return
      // An older server has no filters v2.
      this.filters = (err as { code?: string }).code === 'not_found' ? { status: 'unsupported' } : { status: 'error' }
    }
  }

  private async loadPage(client: CaribouClient, kind: Kind) {
    const list = this.lists[kind]
    const maxId = list.items.length > 0 ? list.nextMaxId ?? undefined : undefined
    this.setList(kind, { loading: true, error: false })
    try {
      const page = await KINDS[kind].fetch(client, maxId)
      if (client !== this.loadedFor) return
      const known = new Set(this.lists[kind].items.map((a) => a.id))
      this.setList(kind, {
        items: [...this.lists[kind].items, ...page.filter((a) => !known.has(a.id))],
        nextMaxId: page.nextMaxId, loading: false,
      })
    } catch {
      if (client === this.loadedFor) this.setList(kind, { loading: false, error: true })
    }
  }

  private setList(kind: Kind, patch: Partial<AccountList>) {
    this.lists = { ...this.lists, [kind]: { ...this.lists[kind], ...patch } }
  }

  // Listed means muted (or blocked) until the cache says otherwise.
  private isOn(kind: Kind, account: Account): boolean {
    const user = activeUser.value
    const rel = user ? relationshipCache.value.get(relationshipKey(user.userKey, account.id)) : undefined
    const flag = rel?.[KINDS[kind].flag]
    return flag === undefined ? true : flag === true
  }

  private onToggle(kind: Kind, account: Account) {
    void KINDS[kind].write(account, !this.isOn(kind, account))
  }

  private onMore(kind: Kind) {
    const client = this.loadedFor
    if (client) void this.loadPage(client, kind)
  }

  private onRetry(kind: Kind) {
    const client = this.loadedFor
    if (client) void this.loadPage(client, kind)
  }

  private renderFilters() {
    const f = this.filters
    const edit = this.server
      ? html`<p><a href=${`https://${this.server}/filters`} target="_blank" rel="noopener">Edit filters on ${this.server}</a></p>`
      : nothing
    if (f.status === 'loading') return html`<p class="notice">Loading filters…</p>`
    if (f.status === 'unsupported') return html`<p class="notice">Your server does not list filters to apps.</p>${edit}`
    if (f.status === 'error') return html`<p role="alert">Could not load your filters.</p>${edit}`
    return html`<div>
      ${f.items.length === 0
        ? html`<p class="notice">You have no filters.</p>`
        : html`<ul>${repeat(f.items, (x) => x.id, (x) => this.renderFilter(x))}</ul>`}
      ${edit}
    </div>`
  }

  private renderFilter(f: Filter) {
    const action = f.filterAction === 'hide' ? 'Hide' : 'Warn'
    const where = f.context.map((c) => CONTEXT_NAMES[c] ?? c).join(', ')
    const words = f.keywords.map((k) => k.keyword).join(', ')
    const posts = f.statuses.length
    return html`<li class="filter" data-filter-id=${f.id}>
      <h3>${f.title}</h3>
      <p class="meta">${action} · ${where}</p>
      ${words ? html`<p>Words: ${words}</p>` : nothing}
      ${posts > 0 ? html`<p>${posts === 1 ? '1 post' : `${posts} posts`}</p>` : nothing}
    </li>`
  }

  private renderAccounts(kind: Kind) {
    const list = this.lists[kind]
    const spec = KINDS[kind]
    const failed = list.error ? html`<div role="alert">Could not load the list.
      <caribou-button variant="secondary" data-action="retry" @click=${() => this.onRetry(kind)}>Retry</caribou-button></div>` : nothing
    if (list.items.length === 0) {
      if (list.error) return failed
      if (list.loading) return html`<p class="notice">Loading…</p>`
      return html`<p class="notice">${spec.empty}</p>`
    }
    return html`<div>
      <ul>${repeat(list.items, (a) => a.id, (a) => {
        const on = this.isOn(kind, a)
        const name = a.displayName || a.username
        return html`<li class="account" data-account-id=${a.id}>
          <img src=${a.avatarStatic || a.avatar} alt="" width="40" height="40" loading="lazy" decoding="async" />
          <a class="who" href=${profilePath(a.acct, this.server)} @click=${spaClick}>
            <strong>${name}</strong><span>@${a.acct}</span>
          </a>
          <caribou-button variant="secondary" data-action=${on ? spec.off.toLowerCase() : spec.on.toLowerCase()}
            @click=${() => this.onToggle(kind, a)}>${on ? spec.off : spec.on}<span class="vh"> @${a.acct}</span></caribou-button>
        </li>`
      })}</ul>
      ${failed}
      ${list.nextMaxId && !list.error
        ? html`<div class="more"><caribou-button variant="secondary" ?loading=${list.loading}
            @click=${() => this.onMore(kind)}>Load more</caribou-button></div>`
        : nothing}
    </div>`
  }

  override render() {
    void this.relRevision
    return html`<div>
      <h1>Filters, mutes and blocks</h1>
      <section aria-labelledby="filters-h">
        <h2 id="filters-h">Filters</h2>
        ${this.renderFilters()}
      </section>
      <section aria-labelledby="mutes-h">
        <h2 id="mutes-h">${KINDS.mutes.heading}</h2>
        ${this.renderAccounts('mutes')}
      </section>
      <section aria-labelledby="blocks-h">
        <h2 id="blocks-h">${KINDS.blocks.heading}</h2>
        ${this.renderAccounts('blocks')}
      </section>
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-moderation-settings': CaribouModerationSettings }
}
