import { Elena, html } from '@elenajs/core'
import { effect } from '@preact/signals-core'
import type { Status, CaribouClient } from '@beatzball/caribou-mastodon-client'
import { activeClient, createThreadStore, type ThreadStore } from '@beatzball/caribou-state'
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
    const all = this.collectStatuses()
    const cards = this.shadowRoot!.querySelectorAll<HTMLElement & { status: Status | null }>(
      'caribou-status-card[data-id]',
    )
    cards.forEach((card) => {
      const id = card.dataset.id!
      const s = all.find((x) => x.id === id) ?? null
      if (s && card.status !== s) card.status = s
    })
  }

  private collectStatuses(): Status[] {
    if (this.store?.focused.value.status === 'ready' && this.store.context.value.status === 'ready') {
      return [
        ...this.store.context.value.data.ancestors,
        this.store.focused.value.data,
        ...this.store.context.value.data.descendants,
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
    const focused = this.store.focused.value.data
    const { ancestors, descendants } = this.store.context.value.data
    const depths = depthMap(focused.id, descendants)
    return html`
      <ul>
        ${ancestors.map((s) => html`
          <li><caribou-status-card data-id="${s.id}" variant="ancestor"></caribou-status-card></li>
        `)}
        <li><caribou-status-card data-id="${focused.id}" variant="focused"></caribou-status-card></li>
        ${descendants.map((s) => {
          const depth = depths.get(s.id) ?? MAX_DEPTH
          const ind = `margin-inline-start:calc(var(--space-4)*${String(depth)})`
          return html`<li data-depth="${String(depth)}" style="${ind}">
            <caribou-status-card data-id="${s.id}" data-depth="${String(depth)}" variant="descendant"></caribou-status-card>
          </li>`
        })}
      </ul>
    `
  }
}
CaribouThread.define()
