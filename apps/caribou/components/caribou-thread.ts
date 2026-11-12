import { readingHeading } from './_shared-styles.js'
import { LitElement, html, css, nothing, type PropertyValues } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
import { effect } from '@preact/signals-core'
import type { Status } from '@beatzball/caribou-mastodon-client'
import {
  activeClient, createKeepAlive, createThreadStore, type ThreadStore,
} from '@beatzball/caribou-state'
import './caribou-status-card.js'
import { isCachedSnapshot } from './_page-cache.js'
import { findShell, loadReaderViewFrom } from './_shell.js'
import { currentBlueskyReader } from './_bluesky-moderation.js'

const MAX_DEPTH = 3

// The stores of the threads the reader saw last. A store holds the order the
// reader saw — new replies at the end — which the server's copy does not, so
// a revisit paints that order again. Emptied when the active account changes.
// Keyed by `threadStoreKey`.
const stores = createKeepAlive<ThreadStore>(12)

/**
 * The key a kept thread store goes under (app README, "Bluesky views", #273).
 * A Bluesky copy's decision belongs to one reader (`viewerOf`), so a Bluesky
 * thread's store is kept per reader: the server's signed-out copy (reader
 * null) is never handed to a signed-in reader, whose cards would wait on it
 * for ever. A store read with no Bluesky reader keys by the id alone, as
 * before.
 */
export function threadStoreKey(statusId: string, reader: string | null): string {
  return reader === null ? statusId : `${reader} ${statusId}`
}

// The reader a seeded thread's copies were read for: the focused post's
// decision's, null for a Mastodon thread or a signed-out copy.
function seedReader(initial: ThreadInitial): string | null {
  return initial.focused.bluesky?.viewerOf ?? null
}

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
  static override styles = [readingHeading, css`
    :host { display: block; }
    ul { list-style: none; padding: 0; margin: 0; }
    /* A card hidden by a filter, a mute or a block takes its row with it. */
    li:has(> caribou-status-card[hidden]) { display: none; }
    .loading { padding: var(--space-4); color: var(--fg-muted); }
  `]

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

  protected override willUpdate(changed: PropertyValues<this>) {
    // The page got the thread again in the background (`enterWithCache`).
    // A cached snapshot is what the store was filled from, so it adds
    // nothing (the same guard as in `caribou-timeline`).
    if (this.store && changed.has('initial') && this.initial && !isCachedSnapshot(this.initial)) {
      this.store.offer(this.initial)
      this.loadReaderView(this.initial)
    }
  }

  // The store is made here, not in connectedCallback: a server-rendered
  // element connects before its parent has hydrated and set `initial`, and
  // the server itself must never fill the module-level status cache.
  protected override firstUpdated() {
    const client = activeClient.value
    // A seeded store is for the reader its copies were read for; one this
    // element reads itself is for the active reader.
    const key = threadStoreKey(this.statusId, this.initial ? seedReader(this.initial) : currentBlueskyReader(client))
    const kept = stores.get(key)
    if (kept) {
      this.store = kept
      // A snapshot is what the store was filled from; data off the network
      // may hold new replies.
      if (this.initial && !isCachedSnapshot(this.initial)) {
        kept.offer(this.initial)
        this.loadReaderView(this.initial)
      }
    } else if (this.initial) {
      // A store seeded with the thread never touches the client, so a
      // signed-out reader gets a working thread too.
      this.store = createThreadStore(client!, this.statusId, { initial: this.initial })
      this.loadReaderView(this.initial)
    } else if (client) {
      this.store = createThreadStore(client, this.statusId, {})
      void this.store.load()
    } else {
      return
    }
    stores.set(key, this.store)
    if (this.isConnected) this.bind()
  }

  // The server fetched the thread without the reader's token, so it has none
  // of the reader's filters; ask again for the reader's copy.
  private loadReaderView({ focused, ancestors, descendants }: ThreadInitial) {
    loadReaderViewFrom(findShell(this)?.getAttribute('instance') ?? '', [...ancestors, focused, ...descendants])
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
    if (!thread) return html`<div><h1 class="reading-heading">Thread</h1><div class="loading">Loading…</div></div>`
    // `repeat` keys each row by status id, so a reply that arrives later
    // moves the existing rows instead of rebuilding them; only the indent
    // of a row changes when its depth does.
    return html`
      <div>
        <h1 class="reading-heading">Thread</h1>
        <ul>
          ${repeat(threadItems(thread), (item) => item.status.id, ({ status, variant, depth }) => html`<li
            data-depth=${depth ?? nothing}
            style=${depth === null ? nothing : `margin-inline-start:calc(var(--space-4) * ${depth})`}
            ><caribou-status-card variant=${variant} data-id=${status.id} data-depth=${depth ?? nothing}
              filter-context="thread" .status=${status}></caribou-status-card
          ></li>`)}
        </ul>
      </div>
    `
  }
}
