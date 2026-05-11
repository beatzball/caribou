import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reconcileKeyedList } from '../reconcile-keyed-list.js'

interface Item { id: string; payload?: unknown }

function makeUl(): HTMLUListElement {
  document.body.innerHTML = ''
  const ul = document.createElement('ul')
  document.body.appendChild(ul)
  return ul
}

function makeLi(item: Item): HTMLLIElement {
  const li = document.createElement('li')
  li.textContent = item.id
  return li
}

describe('reconcileKeyedList — empty → N', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('inserts all items into an empty parent', () => {
    const ul = makeUl()
    const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const create = vi.fn(makeLi)

    reconcileKeyedList({
      parent: ul,
      items,
      keyOf: (i) => i.id,
      create,
    })

    expect(ul.children.length).toBe(3)
    expect(Array.from(ul.children).map((c) => (c as HTMLElement).textContent)).toEqual(['a', 'b', 'c'])
    expect(Array.from(ul.children).map((c) => (c as HTMLElement).dataset.key)).toEqual(['a', 'b', 'c'])
    expect(create).toHaveBeenCalledTimes(3)
  })

  it('fires update for every item on initial mount', () => {
    const ul = makeUl()
    const items: Item[] = [{ id: 'a' }, { id: 'b' }]
    const update = vi.fn()

    reconcileKeyedList({
      parent: ul,
      items,
      keyOf: (i) => i.id,
      create: makeLi,
      update,
    })

    expect(update).toHaveBeenCalledTimes(2)
  })
})

describe('reconcileKeyedList — N → identical N', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('reuses existing children by data-key; zero creates, zero inserts', () => {
    const ul = makeUl()
    const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const createSpy = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    // First call seeds the list.
    reconcileKeyedList({ parent: ul, items, keyOf: (i) => i.id, create: createSpy })
    const refs = Array.from(ul.children)
    createSpy.mockClear()
    insertSpy.mockClear()

    // Second call with the same items — should be a no-op DOM-wise.
    reconcileKeyedList({ parent: ul, items, keyOf: (i) => i.id, create: createSpy })

    expect(createSpy).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
    expect(Array.from(ul.children)).toEqual(refs) // same node identity
  })

  it('fires update once per item even when nothing else changed', () => {
    const ul = makeUl()
    const items: Item[] = [{ id: 'a' }, { id: 'b' }]
    const update = vi.fn()

    reconcileKeyedList({ parent: ul, items, keyOf: (i) => i.id, create: makeLi, update })
    update.mockClear()
    reconcileKeyedList({ parent: ul, items, keyOf: (i) => i.id, create: makeLi, update })

    expect(update).toHaveBeenCalledTimes(2)
  })
})

describe('reconcileKeyedList — prepend / append', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('prepend K: K creates + K inserts + 0 moves; surviving nodes keep identity', () => {
    const ul = makeUl()
    const initial: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    reconcileKeyedList({ parent: ul, items: initial, keyOf: (i) => i.id, create: makeLi })
    const [refA, refB, refC] = Array.from(ul.children)

    const create = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    const next: Item[] = [{ id: 'x' }, { id: 'y' }, { id: 'a' }, { id: 'b' }, { id: 'c' }]
    reconcileKeyedList({ parent: ul, items: next, keyOf: (i) => i.id, create })

    expect(create).toHaveBeenCalledTimes(2)
    expect(insertSpy).toHaveBeenCalledTimes(2) // two inserts of fresh nodes; surviving never re-inserted
    expect(ul.children[2]).toBe(refA)
    expect(ul.children[3]).toBe(refB)
    expect(ul.children[4]).toBe(refC)
  })

  it('append K: K creates + K inserts + 0 moves; surviving nodes keep identity', () => {
    const ul = makeUl()
    const initial: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    reconcileKeyedList({ parent: ul, items: initial, keyOf: (i) => i.id, create: makeLi })
    const [refA, refB, refC] = Array.from(ul.children)

    const create = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    const next: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'y' }, { id: 'z' }]
    reconcileKeyedList({ parent: ul, items: next, keyOf: (i) => i.id, create })

    expect(create).toHaveBeenCalledTimes(2)
    expect(insertSpy).toHaveBeenCalledTimes(2)
    expect(ul.children[0]).toBe(refA)
    expect(ul.children[1]).toBe(refB)
    expect(ul.children[2]).toBe(refC)
  })
})
