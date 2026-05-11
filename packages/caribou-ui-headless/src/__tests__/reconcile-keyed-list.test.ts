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

describe('reconcileKeyedList — removal', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('removes middle: 1 remove, 0 creates, 0 moves', () => {
    const ul = makeUl()
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })
    const [refA, , refC, refD] = Array.from(ul.children)
    const create = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'c' }, { id: 'd' }],
      keyOf: (i: Item) => i.id,
      create,
    })

    expect(ul.children.length).toBe(3)
    expect(create).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
    expect(ul.children[0]).toBe(refA)
    expect(ul.children[1]).toBe(refC)
    expect(ul.children[2]).toBe(refD)
  })

  it('removes all: N removes, 0 creates', () => {
    const ul = makeUl()
    reconcileKeyedList({ parent: ul, items: [{ id: 'a' }, { id: 'b' }], keyOf: (i: Item) => i.id, create: makeLi })
    reconcileKeyedList({ parent: ul, items: [], keyOf: (i: Item) => i.id, create: makeLi })
    expect(ul.children.length).toBe(0)
  })
})

describe('reconcileKeyedList — moves', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('swap adjacent: 1 move, 0 creates, 0 removes', () => {
    const ul = makeUl()
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })
    const create = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'b' }, { id: 'a' }, { id: 'c' }],
      keyOf: (i: Item) => i.id,
      create,
    })

    expect(create).not.toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledTimes(1) // one move
    expect(Array.from(ul.children).map((c) => (c as HTMLElement).dataset.key)).toEqual(['b', 'a', 'c'])
  })

  it('full reverse: (n-1) moves', () => {
    const ul = makeUl()
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })
    const create = vi.fn(makeLi)
    const insertSpy = vi.spyOn(ul, 'insertBefore')

    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'd' }, { id: 'c' }, { id: 'b' }, { id: 'a' }],
      keyOf: (i: Item) => i.id,
      create,
    })

    expect(create).not.toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledTimes(3) // n - 1
    expect(Array.from(ul.children).map((c) => (c as HTMLElement).dataset.key)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('mixed: prepend X, drop A and C, append Y', () => {
    const ul = makeUl()
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })
    const [, refB, , refD] = Array.from(ul.children)
    const create = vi.fn(makeLi)

    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'x' }, { id: 'b' }, { id: 'd' }, { id: 'y' }],
      keyOf: (i: Item) => i.id,
      create,
    })

    expect(create).toHaveBeenCalledTimes(2) // x and y
    expect(ul.children.length).toBe(4)
    expect(Array.from(ul.children).map((c) => (c as HTMLElement).dataset.key)).toEqual(['x', 'b', 'd', 'y'])
    expect(ul.children[1]).toBe(refB)
    expect(ul.children[2]).toBe(refD)
  })
})

describe('reconcileKeyedList — stable identity invariant', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('every surviving element is Object.is to its pre-call ref across mixed mutations', () => {
    const ul = makeUl()
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })
    const refs = new Map<string, Element>()
    for (const child of Array.from(ul.children)) {
      refs.set((child as HTMLElement).dataset.key!, child)
    }

    // Drop b, swap d & e, prepend x.
    reconcileKeyedList({
      parent: ul,
      items: [{ id: 'x' }, { id: 'a' }, { id: 'c' }, { id: 'e' }, { id: 'd' }],
      keyOf: (i: Item) => i.id,
      create: makeLi,
    })

    for (const child of Array.from(ul.children)) {
      const k = (child as HTMLElement).dataset.key!
      if (refs.has(k)) expect(child).toBe(refs.get(k)) // surviving = same ref
    }
  })
})

describe('reconcileKeyedList — direct child without data-key', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('removes hand-injected children that lack a data-key', () => {
    const ul = makeUl()
    reconcileKeyedList({ parent: ul, items: [{ id: 'a' }], keyOf: (i: Item) => i.id, create: makeLi })

    // Simulate drift: someone hand-appended an <li> without going through the helper.
    const stray = document.createElement('li')
    stray.textContent = 'stray'
    ul.appendChild(stray)
    expect(ul.children.length).toBe(2)

    reconcileKeyedList({ parent: ul, items: [{ id: 'a' }], keyOf: (i: Item) => i.id, create: makeLi })
    expect(ul.children.length).toBe(1)
    expect((ul.children[0] as HTMLElement).dataset.key).toBe('a')
  })
})
