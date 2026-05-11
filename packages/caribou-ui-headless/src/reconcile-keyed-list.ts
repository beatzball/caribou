/**
 * Keyed-list reconciler. See
 * docs/superpowers/specs/2026-05-09-caribou-keyed-list-reconciliation-design.md
 * for the full design and op-count contract.
 *
 * Caller contract:
 * - keyOf MUST return a non-empty string per item.
 * - update MUST be a no-op when item is reference-equal to the value
 *   that produced the current DOM state. Callers express this as
 *   `if (card.status !== s) card.status = s`.
 * - parent.children MUST contain only elements created by this helper
 *   (or SSR-emitted with matching data-key attrs). Hand-rendered
 *   children interleaved with helper-managed children is unsupported;
 *   any direct child without a matching key is removed.
 */

// Dev-mode detection. Hardened to tolerate Nitro server bundles where
// `import.meta.env` is undefined (Vite/Vitest define it; plain Node ESM
// and Nitro do not).
const IS_DEV: boolean = (() => {
  try {
    return typeof import.meta !== 'undefined' &&
      Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
  } catch {
    return false
  }
})()

export interface ReconcileKeyedListOptions<T> {
  parent: Element
  items: readonly T[]
  keyOf: (item: T) => string
  create: (item: T) => HTMLElement
  update?: (el: HTMLElement, item: T) => void
}

export function reconcileKeyedList<T>(opts: ReconcileKeyedListOptions<T>): void {
  const { parent, items, keyOf, create, update } = opts

  // Build a map of existing children by data-key.
  const existing = new Map<string, Element>()
  for (const child of Array.from(parent.children)) {
    const k = (child as HTMLElement).dataset.key
    if (k) existing.set(k, child)
  }

  // Compute wanted keys.
  const wantedKeys = new Set<string>()
  const itemKeys: string[] = []
  for (const item of items) {
    const k = keyOf(item)
    itemKeys.push(k)
    wantedKeys.add(k)
  }

  if (IS_DEV && items.length !== wantedKeys.size) {
    throw new Error(`reconcileKeyedList: duplicate key in items array (length ${items.length} vs unique ${wantedKeys.size})`)
  }

  // Strip stale children.
  for (const [k, el] of existing) {
    if (!wantedKeys.has(k)) {
      el.remove()
      existing.delete(k)
    }
  }
  for (const child of Array.from(parent.children)) {
    if (!(child as HTMLElement).dataset.key) child.remove()
  }

  // Walk items in order; reuse existing or create new.
  // The bang (!) assertions on items[i] / itemKeys[i] are safe under
  // noUncheckedIndexedAccess: the loop bound `i < items.length`
  // guarantees both indices are in-range, and itemKeys was populated
  // 1:1 with items in the same iteration order above.
  let cursor: ChildNode | null = parent.firstChild
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const key = itemKeys[i]!
    let el = existing.get(key) as HTMLElement | undefined
    if (el) {
      if (el === cursor) {
        cursor = cursor.nextSibling
      } else {
        parent.insertBefore(el, cursor)
      }
    } else {
      el = create(item)
      el.dataset.key = key
      parent.insertBefore(el, cursor)
    }
    if (update) update(el, item)
  }

  if (IS_DEV) {
    const got = Array.from(parent.children).map((c) => (c as HTMLElement).dataset.key)
    if (got.length !== itemKeys.length || got.some((k, i) => k !== itemKeys[i])) {
      throw new Error(
        `reconcileKeyedList: post-condition violated — parent.children keys [${got.join(',')}] != items keys [${itemKeys.join(',')}]`,
      )
    }
  }
}
