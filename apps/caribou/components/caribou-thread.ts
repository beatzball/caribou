import { LitElement, html, css, nothing } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { Status } from '@beatzball/caribou-mastodon-client'
import { activeClient, createThreadStore, type ThreadStore } from '@beatzball/caribou-state'
import './caribou-status-card.js'

const MAX_DEPTH = 3

export interface ThreadInitial {
  focused: Status
  ancestors: Status[]
  descendants: Status[]
}

interface ThreadItem {
  status: Status
  variant: 'ancestor' | 'focused' | 'descendant'
  // Indent level below the focused status; null for the focused status and
  // everything above it.
  depth: number | null
}

function depthMap(focusedId: string, descendants: Status[]): Map<string, number> {
  const byParent = new Map<string, Status[]>()
  for (const d of descendants) {
    const p = d.inReplyToId
    if (!p) continue
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(d)
  }
  const depths = new Map<string, number>()
  function walk(id: string, depth: number) {
    for (const child of byParent.get(id) ?? []) {
      depths.set(child.id, Math.min(depth, MAX_DEPTH))
      walk(child.id, depth + 1)
    }
  }
  walk(focusedId, 1)
  return depths
}

// The instance returns descendants already in tree order (each reply after
// its parent), so the list keeps that order and only works out the indent.
// A reply whose parent is missing from the tree gets the deepest indent.
function threadItems({ focused, ancestors, descendants }: ThreadInitial): ThreadItem[] {
  const depths = depthMap(focused.id, descendants)
  return [
    ...ancestors.map((status): ThreadItem => ({ status, variant: 'ancestor', depth: null })),
    { status: focused, variant: 'focused', depth: null },
    ...descendants.map((status): ThreadItem => ({
      status, variant: 'descendant', depth: depths.get(status.id) ?? MAX_DEPTH,
    })),
  ]
}

@customElement('caribou-thread')
export class CaribouThread extends LitElement {
  static override styles = css`
    :host { display: block; }
    ul { list-style: none; padding: 0; margin: 0; }
    .loading { padding: var(--space-4); color: var(--fg-muted); }
  `

  // Attribute `statusid`.
  @property({ reflect: true }) statusId = ''
  // The whole thread, fetched by the server. With it the element renders
  // every card on the server and makes no request of its own on mount.
  @property({ attribute: false }) initial: ThreadInitial | null = null

  // What the store holds, once it is ready. Until the store is wired — on
  // the server, and in the hydrating render, which must equal the server's —
  // render() reads `initial` instead.
  @state() private thread: ThreadInitial | null = null

  private store: ThreadStore | null = null
  private dispose: (() => void) | null = null

  override connectedCallback() {
    super.connectedCallback()
    if (this.store) this.bind()
  }

  override disconnectedCallback() {
    this.dispose?.()
    this.dispose = null
    super.disconnectedCallback()
  }

  // The store is made here, not in connectedCallback: a server-rendered
  // element connects before its parent has hydrated and set `initial`, and
  // the server itself must never fill the module-level status cache.
  protected override firstUpdated() {
    const client = activeClient.value
    if (this.initial) {
      // A store seeded with the thread never touches the client, so a
      // signed-out reader gets a working thread too.
      this.store = createThreadStore(client!, this.statusId, { initial: this.initial })
    } else if (client) {
      this.store = createThreadStore(client, this.statusId, {})
      void this.store.load()
    } else {
      return
    }
    if (this.isConnected) this.bind()
  }

  private bind() {
    const store = this.store!
    this.dispose?.()
    this.dispose = effect(() => {
      const focused = store.focused.value
      const context = store.context.value
      this.thread = focused.status === 'ready' && context.status === 'ready'
        ? { focused: focused.data, ...context.data }
        : null
    })
  }

  override render() {
    const thread = this.thread ?? this.initial
    if (!thread) return html`<div class="loading">Loading…</div>`
    // `repeat` keys each row by status id, so a reply that arrives later
    // moves the existing rows instead of rebuilding them; only the indent
    // of a row changes when its depth does.
    return html`
      <ul>
        ${repeat(threadItems(thread), (item) => item.status.id, ({ status, variant, depth }) => html`<li
          data-depth=${depth ?? nothing}
          style=${depth === null ? nothing : `margin-inline-start:calc(var(--space-4) * ${depth})`}
          ><caribou-status-card variant=${variant} data-id=${status.id} data-depth=${depth ?? nothing}
            .status=${status}></caribou-status-card
        ></li>`)}
      </ul>
    `
  }
}
