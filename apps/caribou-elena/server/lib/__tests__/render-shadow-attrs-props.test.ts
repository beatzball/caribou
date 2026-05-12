import { describe, it, expect, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  ;(globalThis as unknown as { window: typeof dom.window }).window = dom.window
  ;(globalThis as unknown as { document: Document }).document =
    dom.window.document as unknown as Document
  ;(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement
  ;(globalThis as unknown as { customElements: CustomElementRegistry }).customElements =
    dom.window.customElements as unknown as CustomElementRegistry
})

describe('renderShadowComponentToString — { attrs, props } form', () => {
  beforeAll(async () => {
    await import('../../../pages/components/caribou-status-card.js')
  })

  it('reflects attrs as host element attributes', async () => {
    const { renderShadowComponentToString } = await import('../render-shadow.js')
    const html = await renderShadowComponentToString('caribou-status-card', {
      attrs: { variant: 'timeline', 'data-rendered-at': '1700000000000' },
    })
    expect(html).toContain('variant="timeline"')
    expect(html).toContain('data-rendered-at="1700000000000"')
  })

  it('does NOT reflect props as host attributes', async () => {
    const { renderShadowComponentToString } = await import('../render-shadow.js')
    const fakeStatus = { id: 'a', content: '<p>x</p>', account: { id: '1' } }
    const html = await renderShadowComponentToString('caribou-status-card', {
      attrs: { variant: 'timeline' },
      props: { status: fakeStatus },
    })
    expect(html).not.toContain('status="')
    expect(html).not.toContain('[object Object]')
  })

  it('legacy form (no attrs/props keys) treats whole object as attrs', async () => {
    const { renderShadowComponentToString } = await import('../render-shadow.js')
    const html = await renderShadowComponentToString('caribou-status-card', {
      variant: 'focused',
    })
    expect(html).toContain('variant="focused"')
  })

  it('empty object is accepted and produces a bare DSD shell', async () => {
    const { renderShadowComponentToString } = await import('../render-shadow.js')
    const html = await renderShadowComponentToString('caribou-status-card', {})
    expect(html).toMatch(/<caribou-status-card>.*<template shadowrootmode="open">/)
  })
})
