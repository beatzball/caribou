import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { mastodon } from 'masto'
import type { CaribouClient } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, activeUserKey, createList, deleteList, listsCache, loadLists, updateList,
} from '@beatzball/caribou-state'
import { boxReset } from './_shared-styles.js'
import { spaClick } from './_spa-link.js'
import { listPath } from './_list-path.js'
import { confirmDialog } from './caribou-confirm-dialog.js'
import { listDialog } from './caribou-list-dialog.js'
import './caribou-button.js'


/** Whether the server has `exclusive` (4.2+): it sends it on every list. */
export const supportsExclusive = (lists: readonly mastodon.v1.List[] | undefined) =>
  !!lists?.some((l) => typeof l.exclusive === 'boolean')

/** Asks for a new list's fields and makes it. Resolves to the list, or null. */
export async function newListFlow(lists: readonly mastodon.v1.List[] | undefined): Promise<mastodon.v1.List | null> {
  const client = activeClient.peek()
  const input = await listDialog({ title: 'New list', submitLabel: 'Create', exclusive: supportsExclusive(lists) })
  if (!input || !client || activeClient.peek()?.userKey !== client.userKey) return null
  return createList(input, { clientSource: () => client })
}

/** Asks for a list's new fields and saves them. */
export async function editListFlow(list: mastodon.v1.List, lists: readonly mastodon.v1.List[] | undefined): Promise<void> {
  const client = activeClient.peek()
  const input = await listDialog({
    title: 'Edit list', submitLabel: 'Save', exclusive: supportsExclusive(lists),
    initial: { title: list.title, repliesPolicy: list.repliesPolicy, exclusive: list.exclusive },
  })
  if (!input || !client || activeClient.peek()?.userKey !== client.userKey) return
  await updateList(list.id, input, { clientSource: () => client })
}

// The reader's lists, with New list, Edit and Delete. Client only: lists
// need the access token, so the page renders this after mount.
@customElement('caribou-lists')
export class CaribouLists extends LitElement {
  static override styles = [boxReset, css`
    :host { display: block; padding: var(--space-4); }
    header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); }
    h1 { font-size: 1.5rem; margin: 0; }
    ul { list-style: none; margin: 0; padding: 0; }
    li {
      display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;
      border-bottom: 1px solid var(--border); padding: var(--space-3) 0;
    }
    a.title {
      flex: 1; min-width: 8rem; color: var(--fg-0); font-weight: 600;
      text-decoration: none; overflow-wrap: anywhere;
    }
    a.title:hover { text-decoration: underline; }
    a.title:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .notice { color: var(--fg-muted); margin: var(--space-2) 0; }
    .failed { display: flex; align-items: center; gap: var(--space-2); }
    [role="alert"] { color: var(--danger); }
    /* Read, not shown: each button names the list it acts on. */
    .vh {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip-path: inset(50%); white-space: nowrap;
    }
  `]

  @state() private lists: mastodon.v1.List[] | undefined = undefined
  @state() private error: string | null = null
  @state() private retrying = false

  private dispose: (() => void) | null = null
  private loadedFor: CaribouClient | null = null

  override connectedCallback() {
    super.connectedCallback()
    this.dispose = effect(() => {
      const key = activeUserKey.value
      this.lists = key ? listsCache.value.get(key) : undefined
      const client = activeClient.value
      if (client && client !== this.loadedFor) {
        this.loadedFor = client
        void this.load(client)
      }
    })
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    this.loadedFor = null
    super.disconnectedCallback()
  }

  private async load(client: CaribouClient) {
    this.error = null
    try {
      await loadLists({ clientSource: () => client })
    } catch (err) {
      if (this.loadedFor === client) this.error = (err as Error).message || 'Could not load your lists.'
    }
  }

  private onRetry = async () => {
    const client = activeClient.peek()
    if (!client || this.retrying) return
    this.retrying = true
    try {
      await this.load(client)
    } finally {
      this.retrying = false
    }
  }

  private onNew = async () => {
    const made = await newListFlow(this.lists)
    if (!made) return
    await this.updateComplete
    const row = [...this.renderRoot.querySelectorAll<HTMLElement>('li')].find((li) => li.dataset.listId === made.id)
    row?.querySelector<HTMLElement>('a.title')?.focus()
  }

  private onDelete = async (list: mastodon.v1.List, e: Event) => {
    const button = e.currentTarget as HTMLElement
    const client = activeClient.peek()
    if (!client) return
    const ok = await confirmDialog({
      title: `Delete "${list.title}"?`,
      message: 'The list goes for good. The accounts in it stay followed.',
      confirmLabel: 'Delete',
    })
    if (!ok || activeClient.peek()?.userKey !== client.userKey) return
    // The row goes, and with it the focused button: focus moves to the next
    // row's link, or to New list.
    const rows = [...this.renderRoot.querySelectorAll<HTMLElement>('li')]
    const at = rows.findIndex((r) => r.contains(button))
    const done = deleteList(list.id, { clientSource: () => client })
    await this.updateComplete
    const next = this.renderRoot.querySelectorAll<HTMLElement>('li a.title')[Math.max(0, at)]
      ?? this.renderRoot.querySelectorAll<HTMLElement>('li a.title')[at - 1]
    ;(next ?? this.renderRoot.querySelector<HTMLElement>('caribou-button.new'))?.focus()
    // A failure brings the row back and a toast says so.
    await done
  }

  private renderBody() {
    if (this.error) {
      return html`<div class="failed"><div role="alert">${this.retrying ? '' : this.error}</div>
        <caribou-button variant="secondary" ?loading=${this.retrying} @click=${this.onRetry}>Retry</caribou-button></div>`
    }
    const lists = this.lists
    if (!lists) return html`<p class="notice">Loading your lists…</p>`
    if (lists.length === 0) {
      return html`<p class="notice">No lists yet. A list is a timeline of a few accounts you follow.</p>`
    }
    return html`<ul>
      ${repeat(lists, (l) => l.id, (l) => html`<li data-list-id=${l.id}>
        <a class="title" href=${listPath(l.id)} @click=${spaClick}>${l.title}</a>
        <caribou-button class="edit" variant="secondary"
          @click=${() => { void editListFlow(l, this.lists) }}>Edit<span class="vh"> ${l.title}</span></caribou-button>
        <caribou-button class="delete" variant="danger"
          @click=${(e: Event) => { void this.onDelete(l, e) }}>Delete<span class="vh"> ${l.title}</span></caribou-button>
      </li>`)}
    </ul>`
  }

  override render() {
    return html`<div>
      <header>
        <h1>Lists</h1>
        <caribou-button class="new" variant="primary" @click=${this.onNew}>New list</caribou-button>
      </header>
      ${this.renderBody()}
    </div>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-lists': CaribouLists }
}
