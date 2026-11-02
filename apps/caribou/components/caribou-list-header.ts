import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUser, activeUserKey, listKey, listMembersCache, listsCache, loadList, loadListMembers,
  setListMember,
} from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'
import { profilePath } from './_profile-path.js'
import { spaClick } from './_spa-link.js'
import { editListFlow } from './caribou-lists.js'
import './caribou-button.js'

type Members = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: mastodon.v1.Account[] }

// The top of a list's timeline: its title, Edit and Members. Members opens
// a panel below the header with each account and a Remove button. New
// members are added from a profile ("Add to lists" in its menu), since the
// server takes only accounts the reader follows.
//
// Client only: the list needs the access token.
@customElement('caribou-list-header')
export class CaribouListHeader extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; border-bottom: 1px solid var(--border); }
    header { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-4); }
    h1 { flex: 1; min-width: 8rem; margin: 0; color: var(--fg-0); font-size: 1.25rem; overflow-wrap: anywhere; }
    .actions { display: flex; gap: var(--space-2); }
    /* A native button: its aria-controls names the panel in this root,
       which a shared control's inner button could not reach (README). */
    button.members {
      min-block-size: 2.25rem; padding: var(--space-2) var(--space-3);
      font: inherit; color: var(--fg-0); background: var(--bg-1);
      border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer;
    }
    button.members:hover { background: color-mix(in srgb, var(--bg-1) 85%, var(--fg-0)); }
    button.members:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    button.members[aria-expanded="true"] { background: var(--bg-2); }
    @media (pointer: coarse) { button.members { min-block-size: 44px; } }
    #members { padding: 0 var(--space-4) var(--space-4); }
    #members h2 { margin: 0 0 var(--space-2); font-size: 1rem; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }
    li:last-child { border-bottom: 0; }
    img, .no-avatar { inline-size: 40px; block-size: 40px; border-radius: var(--radius-md); flex-shrink: 0; }
    .no-avatar { display: block; background: var(--bg-2); }
    .who { flex: 1; min-width: 0; display: flex; flex-direction: column; color: inherit; text-decoration: none; overflow-wrap: anywhere; }
    .who:hover strong { text-decoration: underline; }
    .who:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .who strong { color: var(--fg-0); }
    .who span { color: var(--fg-muted); }
    .notice { color: var(--fg-muted); margin: var(--space-2) 0; }
    [role="alert"] { color: var(--danger); margin: var(--space-2) 0; }
    .vh {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
  `]

  /** The list's id. */
  @property() list = ''

  @state() private known: mastodon.v1.List | undefined = undefined
  @state() private lists: mastodon.v1.List[] | undefined = undefined
  @state() private missing = false
  @state() private open = false
  @state() private members: Members = { status: 'loading' }
  @state() private server = ''

  private dispose: (() => void) | null = null
  private loadedFor: CaribouClient | null = null
  private membersFor: CaribouClient | null = null

  override connectedCallback() {
    super.connectedCallback()
    this.dispose = effect(() => {
      const key = activeUserKey.value
      this.lists = key ? listsCache.value.get(key) : undefined
      this.known = this.lists?.find((l) => l.id === this.list)
      this.server = activeUser.value?.server ?? ''
      const items = key ? listMembersCache.value.get(listKey(key, this.list)) : undefined
      if (items) this.members = { status: 'ready', items }
      const client = activeClient.value
      if (client && client !== this.loadedFor) {
        this.loadedFor = client
        this.membersFor = null
        void this.loadTitle(client)
        if (this.open) void this.loadMembers(client)
      }
    })
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    this.loadedFor = null
    this.membersFor = null
    super.disconnectedCallback()
  }

  // Asks for the list itself even when it is known: a rename made elsewhere
  // shows here.
  private async loadTitle(client: CaribouClient) {
    this.missing = false
    try {
      await loadList(this.list, { clientSource: () => client })
    } catch (err) {
      if ((err as { code?: string }).code === 'not_found' && this.loadedFor === client) this.missing = true
    }
  }

  private async loadMembers(client: CaribouClient) {
    if (this.membersFor === client) return
    this.membersFor = client
    if (this.members.status !== 'ready') this.members = { status: 'loading' }
    try {
      await loadListMembers(this.list, { clientSource: () => client })
    } catch (err) {
      if (this.membersFor !== client) return
      this.membersFor = null
      this.members = { status: 'error', message: (err as Error).message || 'Could not load the members.' }
    }
  }

  private onToggle = () => {
    this.open = !this.open
    const client = activeClient.peek()
    if (this.open && client) void this.loadMembers(client)
  }

  private onRetry = () => {
    const client = activeClient.peek()
    if (client) void this.loadMembers(client)
  }

  private onEdit = () => {
    if (this.known) void editListFlow(this.known, this.lists)
  }

  private onRemove = async (account: mastodon.v1.Account, e: Event) => {
    const client = activeClient.peek()
    if (!client) return
    const button = e.currentTarget as HTMLElement
    const rows = [...this.renderRoot.querySelectorAll<HTMLElement>('#members li')]
    const at = rows.findIndex((r) => r.contains(button))
    const done = setListMember(this.list, account, false, { clientSource: () => client })
    await this.updateComplete
    // The row goes with the focused button: focus moves to the next row,
    // or back to Members.
    const buttons = this.renderRoot.querySelectorAll<HTMLElement>('#members caribou-button.remove')
    ;(buttons[at] ?? buttons[at - 1] ?? this.renderRoot.querySelector<HTMLElement>('button.members'))?.focus()
    await done
  }

  private renderMembers() {
    if (!this.open) return html`<section id="members" hidden></section>`
    const m = this.members
    let body
    if (m.status === 'loading') body = html`<p class="notice">Loading the members…</p>`
    else if (m.status === 'error') {
      body = html`<div role="alert">${m.message}</div>
        <caribou-button variant="secondary" @click=${this.onRetry}>Retry</caribou-button>`
    } else if (m.items.length === 0) {
      body = html`<p class="notice">No one is in this list yet. Open a profile of someone you follow and choose Add to lists.</p>`
    } else {
      body = html`<ul>${repeat(m.items, (a) => a.id, (a) => html`<li data-account-id=${a.id}>
        ${a.avatarStatic || a.avatar
          ? html`<img src=${a.avatarStatic || a.avatar} alt="" width="40" height="40" loading="lazy" decoding="async" />`
          : html`<span class="no-avatar" aria-hidden="true"></span>`}
        <a class="who" href=${profilePath(a.acct, this.server)} @click=${spaClick}>
          <strong>${a.displayName || a.username}</strong><span>@${a.acct}</span></a>
        <caribou-button class="remove" variant="secondary"
          @click=${(e: Event) => { void this.onRemove(a, e) }}>Remove<span class="vh"> @${a.acct}</span></caribou-button>
      </li>`)}</ul>`
    }
    return html`<section id="members" aria-labelledby="members-h"><h2 id="members-h">Members</h2>${body}</section>`
  }

  override render() {
    const title = this.missing ? 'This list does not exist.' : this.known?.title ?? 'List'
    return html`<div>
      <header>
        <h1>${title}</h1>
        ${this.missing ? nothing : html`<div class="actions">
          <caribou-button class="edit" variant="secondary" ?disabled=${!this.known} @click=${this.onEdit}
            >Edit list</caribou-button>
          <button type="button" class="members" aria-expanded=${this.open ? 'true' : 'false'}
            aria-controls="members" @click=${this.onToggle}>Members</button>
        </div>`}
      </header>
      ${this.renderMembers()}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-list-header': CaribouListHeader }
}
