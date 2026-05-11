// packages/caribou-ui-headless/src/__tests__/reconcile-keyed-list.bench-counts.test.ts
//
// Op-count regression tests. Asserts the EXACT op counts from spec §3.4
// for the keyed-list reconciler. If a future refactor accidentally
// introduces additional moves, removes, or creates for any covered
// scenario, this file fails with a clear delta.
//
// Op definitions (spec §3.4):
//  - create: one create(item) invocation
//  - insert: parent.insertBefore for a freshly-created element
//  - move:   parent.insertBefore for an existing element AND el !== cursor
//            AND el !== cursor.previousSibling (excludes self-move no-op)
//  - remove: el.remove() invocation
//  - update: update(el, item) invocation

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reconcileKeyedList } from '../reconcile-keyed-list.js'

interface Item { id: string }

function setup() {
  document.body.innerHTML = ''
  const ul = document.createElement('ul')
  document.body.appendChild(ul)

  const counts = { create: 0, insert: 0, move: 0, remove: 0, update: 0 }
  const create = (i: Item) => { counts.create++; const li = document.createElement('li'); li.textContent = i.id; return li }
  const update = () => { counts.update++ }

  const realInsertBefore = ul.insertBefore.bind(ul)
  const knownChildren = new WeakSet<Node>()
  ul.insertBefore = function<T extends Node>(node: T, ref: Node | null): T {
    if (knownChildren.has(node)) {
      // existing element being repositioned: count as move only if not a no-op
      const prevSibling: Node | null = ref?.previousSibling ?? null
      if (node !== (ref as Node | null) && node !== prevSibling) counts.move++
    } else {
      counts.insert++
      knownChildren.add(node)
    }
    return realInsertBefore(node, ref) as T
  } as typeof ul.insertBefore

  const realRemove = Element.prototype.remove
  const removeSpy = vi.spyOn(Element.prototype, 'remove').mockImplementation(function(this: Element) {
    if (this.parentElement === ul) counts.remove++
    realRemove.call(this)
  })

  return {
    ul,
    counts,
    create,
    update,
    cleanup: () => removeSpy.mockRestore(),
  }
}

function run(s: ReturnType<typeof setup>, items: Item[]) {
  reconcileKeyedList({ parent: s.ul, items, keyOf: (i) => i.id, create: s.create, update: s.update })
}

describe('reconcile-keyed-list — op-count regression contract', () => {
  let s: ReturnType<typeof setup>
  beforeEach(() => { s = setup() })

  it('empty → N=5: 5 creates, 5 inserts, 0 moves, 0 removes, 5 updates', () => {
    run(s, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }])
    expect(s.counts).toEqual({ create: 5, insert: 5, move: 0, remove: 0, update: 5 })
    s.cleanup()
  })

  it('N=5 → identical: 0 creates, 0 inserts, 0 moves, 0 removes, 5 updates', () => {
    const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
    run(s, items)
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, items)
    expect(s.counts).toEqual({ create: 0, insert: 0, move: 0, remove: 0, update: 5 })
    s.cleanup()
  })

  it('prepend K=3 onto N=5: 3 creates, 3 inserts, 0 moves, 0 removes, 8 updates', () => {
    const initial: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
    run(s, initial)
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, [{ id: 'x' }, { id: 'y' }, { id: 'z' }, ...initial])
    expect(s.counts).toEqual({ create: 3, insert: 3, move: 0, remove: 0, update: 8 })
    s.cleanup()
  })

  it('append K=3 onto N=5: 3 creates, 3 inserts, 0 moves, 0 removes, 8 updates', () => {
    const initial: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
    run(s, initial)
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, [...initial, { id: 'x' }, { id: 'y' }, { id: 'z' }])
    expect(s.counts).toEqual({ create: 3, insert: 3, move: 0, remove: 0, update: 8 })
    s.cleanup()
  })

  it('remove-middle (5 → 3): 0 creates, 0 inserts, 0 moves, 2 removes, 3 updates', () => {
    run(s, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }])
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, [{ id: 'a' }, { id: 'c' }, { id: 'e' }])
    expect(s.counts).toEqual({ create: 0, insert: 0, move: 0, remove: 2, update: 3 })
    s.cleanup()
  })

  it('swap adjacent (n=3): 0 creates, 0 inserts, 1 move, 0 removes, 3 updates', () => {
    run(s, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, [{ id: 'b' }, { id: 'a' }, { id: 'c' }])
    expect(s.counts).toEqual({ create: 0, insert: 0, move: 1, remove: 0, update: 3 })
    s.cleanup()
  })

  it('full reverse (n=4): 0 creates, 0 inserts, 3 moves (n-1), 0 removes, 4 updates', () => {
    run(s, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    s.counts.create = 0; s.counts.insert = 0; s.counts.update = 0
    run(s, [{ id: 'd' }, { id: 'c' }, { id: 'b' }, { id: 'a' }])
    expect(s.counts).toEqual({ create: 0, insert: 0, move: 3, remove: 0, update: 4 })
    s.cleanup()
  })
})
