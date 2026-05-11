import { Elena, html } from '@elenajs/core'
import { effect } from '@preact/signals-core'
import type { Status, CaribouClient } from '@beatzball/caribou-mastodon-client'
import { activeClient, createThreadStore, type ThreadStore } from '@beatzball/caribou-state'
import { reconcileKeyedList } from '@beatzball/caribou-ui-headless'
import type { CaribouListMount } from '@beatzball/caribou-ui-headless'
import './caribou-status-card.js'

const THREAD_CSS = `
  :host { display: block; }
  ul { list-style: none; padding: 0; margin: 0; }
`

const MAX_DEPTH = 3

interface ThreadInitial {
  focused: Status
  ancestors: Status[]
  descendants: Status[]
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
      const capped = Math.min(depth, MAX_DEPTH)
      depths.set(child.id, capped)
      walk(child.id, depth + 1)
    }
  }
  walk(focusedId, 1)
  return depths
}

export class CaribouThread extends Elena(HTMLElement) {
  static override tagName = 'caribou-thread'
  static override shadow = 'open' as const
  static override styles = THREAD_CSS
  // Lowercase prop names: HTML attributes are stored lowercase by the
  // browser, and Elena's `observedAttributes` returns prop names verbatim.
  // A camelCase prop (`statusId`) returns `['statusId']` from
  // observedAttributes, but the parsed attribute name is `statusid` — the
  // case-sensitive comparison in the Custom Elements spec misses, the
  // attributeChangedCallback never fires, and the property stays at its
  // class-field default (`''`). Keep prop names lowercase so the SSR'd
  // attribute → prop wiring works.
  static override props = [
    { name: 'statusid', reflect: true },
    { name: 'initial',  reflect: false },
  ]
  statusid: string = ''
  initial: ThreadInitial | null = null

  private store: ThreadStore | null = null
  private dispose: (() => void) | null = null
  private listEl: HTMLUListElement | null = null

  override async connectedCallback() {
    super.connectedCallback?.()
    // Yield once before reading `this.initial`. Elena's lifecycle runs the
    // child's connectedCallback synchronously inside the parent's render,
    // so the parent page's `updated()` (which sets `this.initial` from its
    // SSR-baked pageData) hasn't run yet at this point. A microtask hop
    // lets the parent's updated() complete before we decide whether to
    // skip the redundant fetch.
    await Promise.resolve()
    const client = activeClient.value
    // With `initial` set, load() short-circuits without touching the client,
    // so a missing client is safe in the SSR-seeded path.
    this.store = createThreadStore(
      client as CaribouClient,
      this.statusid,
      this.initial ? { initial: this.initial } : {},
    )
    if (!this.initial) await this.store.load()
    this.dispose = effect(() => {
      void this.store!.focused.value
      void this.store!.context.value
      this.requestUpdate()
    })
  }

  override disconnectedCallback() {
    this.dispose?.()
    super.disconnectedCallback?.()
  }

  override updated() {
    if (!this.listEl) {
      const mount = this.shadowRoot!.querySelector<CaribouListMount>('caribou-list-mount')
      this.listEl = mount?.mountUl ?? null
    }
    this.reconcile()
  }

  private reconcile() {
    if (!this.listEl) return
    const focusedId = this.store?.focused.value.status === 'ready' ? this.store.focused.value.data.id : null
    reconcileKeyedList({
      parent: this.listEl,
      items: this.collectThreadItems(),
      keyOf: ({ status }) => status.id,
      create: ({ status, depth }) => {
        const li = document.createElement('li')
        const card = document.createElement('caribou-status-card') as HTMLElement & { status?: Status }
        card.dataset.id = status.id
        const variant =
          status.id === focusedId ? 'focused' :
          depth === null ? 'ancestor' :
          'descendant'
        card.setAttribute('variant', variant)
        if (depth !== null) {
          li.dataset.depth = String(depth)
          li.style.marginInlineStart = `calc(var(--space-4)*${depth})`
          card.dataset.depth = String(depth)
        }
        card.status = status
        li.appendChild(card)
        return li
      },
      update: (li, { status, depth }) => {
        const card = li.firstElementChild as HTMLElement & { status?: Status }
        if (card.status !== status) card.status = status
        if (depth !== null) {
          const want = String(depth)
          if (li.dataset.depth !== want) {
            li.dataset.depth = want
            li.style.marginInlineStart = `calc(var(--space-4)*${want})`
            card.dataset.depth = want
          }
        }
      },
    })
  }

  private collectThreadItems(): { status: Status; depth: number | null }[] {
    if (
      this.store?.focused.value.status === 'ready' &&
      this.store.context.value.status === 'ready'
    ) {
      const focused = this.store.focused.value.data
      const { ancestors, descendants } = this.store.context.value.data
      const depths = depthMap(focused.id, descendants)
      return [
        ...ancestors.map((s) => ({ status: s, depth: null as number | null })),
        { status: focused, depth: null as number | null },
        ...descendants.map((s) => ({ status: s, depth: depths.get(s.id) ?? MAX_DEPTH })),
      ]
    }
    return []
  }

  override render() {
    if (!this.store ||
        this.store.focused.value.status !== 'ready' ||
        this.store.context.value.status !== 'ready') {
      return html`<div style="padding:var(--space-4);color:var(--fg-muted);">Loading…</div>`
    }
    return html`<caribou-list-mount></caribou-list-mount>`
  }
}
CaribouThread.define()
