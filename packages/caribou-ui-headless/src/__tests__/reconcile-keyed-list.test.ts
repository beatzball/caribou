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
