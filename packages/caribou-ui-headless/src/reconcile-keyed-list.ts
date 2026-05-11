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
export interface ReconcileKeyedListOptions<T> {
  parent: Element
  items: readonly T[]
  keyOf: (item: T) => string
  create: (item: T) => HTMLElement
  update?: (el: HTMLElement, item: T) => void
}

export function reconcileKeyedList<T>(opts: ReconcileKeyedListOptions<T>): void {
  const { parent, items, keyOf, create, update } = opts

  // Step 1: build a map of existing children by data-key.
  const existing = new Map<string, Element>()
  for (const child of Array.from(parent.children)) {
    const k = (child as HTMLElement).dataset.key
    if (k) existing.set(k, child)
  }

  // Step 2: walk items in order; reuse existing or create new.
  let cursor: ChildNode | null = parent.firstChild
  for (const item of items) {
    const key = keyOf(item)
    let el = existing.get(key) as HTMLElement | undefined
    if (el) {
      if (el === cursor) {
        cursor = cursor.nextSibling
      } else {
        parent.insertBefore(el, cursor)
        // cursor unchanged: el is now before cursor
      }
    } else {
      el = create(item)
      el.dataset.key = key
      parent.insertBefore(el, cursor)
      // cursor unchanged: new el is before cursor
    }
    if (update) update(el, item)
  }
}
