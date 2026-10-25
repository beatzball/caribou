import { afterEach, describe, expect, it } from 'vitest'
import { render, type LitElement } from 'lit'
import { UI_CASES } from '../../tests/integration/_ui-controls-cases.js'

// The client half of the hydration check for the shared controls; the
// server half is `tests/integration/ssr-ui-controls.test.ts`. Both compare
// against the same `server` markup, so a change on one side that the other
// does not make fails here or there.

// A comparable form of a tree: attributes sorted (Lit sets bound ones after
// the static ones, so order differs), no comments, no styles, any icon SVG
// reduced to `<svg></svg>`, whitespace collapsed.
function canon(node: Node): string {
  let out = ''
  for (const n of node.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent!.replace(/\s+/g, ' ').trim()
      if (t) out += t
    } else if (n instanceof Element) {
      const tag = n.localName
      if (tag === 'style') continue
      if (tag === 'svg') { out += '<svg></svg>'; continue }
      const attrs = [...n.attributes].map((a) => `${a.name}="${a.value}"`).sort().join(' ')
      out += `<${tag}${attrs ? ' ' + attrs : ''}>${canon(n)}</${tag}>`
    }
  }
  return out
}

function parse(markup: string): DocumentFragment {
  const t = document.createElement('template')
  t.innerHTML = markup
  return t.content
}

afterEach(() => { document.body.replaceChildren() })

describe('shared controls: first client render equals the server render', () => {
  for (const c of UI_CASES) {
    it(c.name, async () => {
      const root = document.createElement('div')
      document.body.appendChild(root)
      render(c.template(), root)
      const host = root.firstElementChild as LitElement
      await host.updateComplete
      expect(canon(host.shadowRoot!)).toBe(canon(parse(c.server)))
    })
  }
})
