import { describe, expect, it } from 'vitest'

describe('smoke', () => {
  it('runs in happy-dom', () => {
    const el = document.createElement('div')
    el.textContent = 'caribou'
    expect(el.textContent).toBe('caribou')
  })
})
