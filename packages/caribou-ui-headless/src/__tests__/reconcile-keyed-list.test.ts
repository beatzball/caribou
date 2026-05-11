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
