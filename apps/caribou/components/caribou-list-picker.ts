import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { CaribouClient, Account, List } from '@beatzball/caribou-mastodon-client'
import {
  accountListsCache, activeClient, activeUserKey, listKey, listsCache, loadAccountLists, loadLists, setListMember,
} from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'
import { spaClick } from './_spa-link.js'
import { newListFlow, toastRemoved } from './_list-flows.js'
import './caribou-button.js'

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready' }

// "Add to lists" from a profile: every list of the reader's, with a check
// box for whether it holds the account. A change is sent at once; a failed
// one puts the box back and a toast says why. A native `<dialog>`: focus
// stays inside, Escape closes it, and focus goes back to what opened it.
@customElement('caribou-list-picker')
export class CaribouListPicker extends LitElement {
  static override styles = [boxReset, css`
    dialog {
      inline-size: min(28rem, calc(100vw - 2 * var(--space-4)));
      max-block-size: min(32rem, calc(100dvh - 2 * var(--space-4)));
      padding: var(--space-4); color: var(--fg-0); background: var(--bg-0);
      border: 1px solid var(--border); border-radius: var(--radius-md);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.5); }
    h2 { margin: 0 0 var(--space-1); font-size: 1.125rem; overflow-wrap: anywhere; }
    .hint { margin: 0 0 var(--space-3); color: var(--fg-muted); font-size: 0.875rem; }
    ul { list-style: none; margin: 0; padding: 0; }
    label { display: flex; align-items: center; gap: var(--space-2); min-block-size: 44px; overflow-wrap: anywhere; }
    input { margin: 0; accent-color: var(--accent); inline-size: 18px; block-size: 18px; flex-shrink: 0; }
    .notice { color: var(--fg-muted); margin: var(--space-2) 0; }
    [role="alert"] { color: var(--danger); margin: var(--space-2) 0; }
    a { color: var(--accent); }
    .buttons { display: flex; justify-content: space-between; gap: var(--space-2); margin-top: var(--space-4); }
  `]

  @property({ attribute: false }) account: Account | null = null
  /** Whether the reader follows the account: a Mastodon server adds only those. */
  @property({ type: Boolean }) following = true

  @state() private lists: List[] | undefined = undefined
  @state() private memberOf: string[] | undefined = undefined
  @state() private loaded: Loaded = { status: 'loading' }

  private dispose: (() => void) | null = null
  private resolve: (() => void) | null = null
  private cancelled = false

  override connectedCallback() {
    super.connectedCallback()
    this.dispose = effect(() => {
      const key = activeUserKey.value
      this.lists = key ? listsCache.value.get(key) : undefined
      this.memberOf = key && this.account ? accountListsCache.value.get(listKey(key, this.account.id)) : undefined
    })
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    super.disconnectedCallback()
  }

  private async load(client: CaribouClient) {
    const account = this.account
    if (!account) return
    this.loaded = { status: 'loading' }
    try {
      await Promise.all([
        loadLists({ clientSource: () => client }),
        loadAccountLists(account.id, { clientSource: () => client }),
      ])
      this.loaded = { status: 'ready' }
    } catch (err) {
      this.loaded = { status: 'error', message: (err as Error).message || 'Could not load your lists.' }
    }
  }

  /** Opens the picker. Resolves when it closes. */
  async show(): Promise<void> {
    await this.updateComplete
    if (this.cancelled) return
    const client = activeClient.peek()
    const dialog = this.renderRoot.querySelector('dialog')!
    return new Promise((resolve) => {
      this.resolve = resolve
      dialog.showModal()
      this.renderRoot.querySelector<HTMLElement>('caribou-button.done')?.focus()
      if (client) void this.load(client)
    })
  }

  private finish() {
    const resolve = this.resolve
    this.resolve = null
    this.renderRoot.querySelector('dialog')?.close()
    resolve?.()
  }

  /** Closes the picker, even before it opened. */
  cancel() {
    this.cancelled = true
    this.finish()
  }

  private onChange = (list: List, e: Event) => {
    const client = activeClient.peek()
    if (!client || !this.account) return
    const account = this.account
    const member = (e.target as HTMLInputElement).checked
    // A removal that worked says so, with Undo, as on the list's page.
    void setListMember(list.id, account, member, { clientSource: () => client }).then((ok) => {
      if (ok && !member && activeUserKey.peek() === client.userKey) toastRemoved(client, list.id, account)
    })
  }

  private onNew = async () => {
    const client = activeClient.peek()
    const made = await newListFlow(this.lists)
    if (!made || !client || !this.account || !this.isConnected) return
    // A new list is made for this account: it goes in at once.
    await setListMember(made.id, this.account, true, { clientSource: () => client })
  }

  private onRetry = () => {
    const client = activeClient.peek()
    if (client) void this.load(client)
  }

  private renderBody() {
    if (this.loaded.status === 'error') {
      return html`<div role="alert">${this.loaded.message}</div>
        <caribou-button variant="secondary" @click=${this.onRetry}>Retry</caribou-button>`
    }
    const lists = this.lists
    const memberOf = this.memberOf
    if (!lists || !memberOf) return html`<p class="notice">Loading your lists…</p>`
    if (lists.length === 0) {
      return html`<p class="notice">You have no lists yet. Make one with New list, or on
        <a href="/lists" @click=${(e: MouseEvent) => { this.finish(); spaClick(e) }}>Lists</a>.</p>`
    }
    return html`<ul>${repeat(lists, (l) => l.id, (l) => html`<li>
      <label><input type="checkbox" data-list-id=${l.id} .checked=${memberOf.includes(l.id)}
        @change=${(e: Event) => this.onChange(l, e)} />${l.title}</label>
    </li>`)}</ul>`
  }

  override render() {
    const acct = this.account?.acct ?? ''
    // Bluesky takes any account; Mastodon only one the reader follows.
    const hint = !this.following && !this.account?.bluesky
    return html`<dialog aria-labelledby="h" aria-describedby=${hint ? 'hint' : nothing}
      @close=${() => this.finish()}>
      <h2 id="h">Lists for @${acct}</h2>
      ${!hint ? nothing
        : html`<p id="hint" class="hint">Only accounts you follow can be added to a list.</p>`}
      ${this.renderBody()}
      <div class="buttons">
        <caribou-button class="new" variant="secondary" @click=${this.onNew}>New list</caribou-button>
        <caribou-button class="done" variant="primary" @click=${() => this.finish()}>Done</caribou-button>
      </div>
    </dialog>`
  }
}

/**
 * Opens the reader's lists for the account, with a box for each. Resolves
 * when it closes; it closes when the active account changes. Client only.
 * `account` must be the reader's own server's copy (its id is per server).
 */
export async function openListPicker(account: Account, following: boolean): Promise<void> {
  const el = document.createElement('caribou-list-picker') as CaribouListPicker
  el.account = account
  el.following = following
  document.body.appendChild(el)
  const owner = activeUserKey.peek()
  const stop = effect(() => { if (activeUserKey.value !== owner) el.cancel() })
  try {
    await el.show()
  } finally {
    stop()
    el.remove()
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-list-picker': CaribouListPicker }
}
