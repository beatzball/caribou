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

  for (const item of items) {
    const key = keyOf(item)
    const el = create(item)
    el.dataset.key = key
    parent.appendChild(el)
    if (update) update(el, item)
  }
}
