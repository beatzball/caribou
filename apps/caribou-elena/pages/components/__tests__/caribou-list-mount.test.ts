import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { CaribouListMount } from '../caribou-list-mount.js'

beforeAll(async () => {
  await import('../caribou-list-mount.js')
})

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('<caribou-list-mount> (Elena)', () => {
  it('attaches an open shadow root with a <ul> mount', async () => {
    const el = document.createElement('caribou-list-mount') as CaribouListMount
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot).not.toBeNull()
    expect(el.shadowRoot!.querySelector('ul')).not.toBeNull()
    expect(el.mountUl).toBe(el.shadowRoot!.querySelector('ul'))
  })

  it('renders an empty shadow <ul> when items is unset', async () => {
    const el = document.createElement('caribou-list-mount') as CaribouListMount
    document.body.appendChild(el)
    await Promise.resolve()
    expect(el.shadowRoot!.querySelector('ul')!.children.length).toBe(0)
  })

  it('renders items children into the shadow <ul>', async () => {
    const el = document.createElement('caribou-list-mount') as CaribouListMount
    el.setAttribute(
      'items',
      '<li data-key="a"><span>A</span></li><li data-key="b"><span>B</span></li>',
    )
    document.body.appendChild(el)
    await Promise.resolve()
    const lis = Array.from(el.shadowRoot!.querySelector('ul')!.children) as HTMLElement[]
    expect(lis.length).toBe(2)
    expect(lis[0]!.dataset.key).toBe('a')
    expect(lis[1]!.dataset.key).toBe('b')
  })

  it('exposes a stable mountUl reference', async () => {
    const el = document.createElement('caribou-list-mount') as CaribouListMount
    document.body.appendChild(el)
    await Promise.resolve()
    const ul1 = el.mountUl
    const ul2 = el.mountUl
    expect(ul1).toBe(ul2)
  })
})
