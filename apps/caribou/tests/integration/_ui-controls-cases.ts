import { html, type TemplateResult } from 'lit'
import '../../components/caribou-button.js'
import '../../components/caribou-icon.js'
import '../../components/caribou-icon-button.js'

// The shared controls, in the states that change their markup. The server
// test renders each one with Lit SSR and pins its shadow markup in
// `server`; the component test renders the same template in happy-dom and
// checks its first client render against that markup. Together they hold
// the hydration rule: server render = first client render.
export interface UiCase { name: string; template: () => TemplateResult; server: string }

// Icons are static templates, identical on both sides; `<svg></svg>` in
// `server` stands for any one of them, so the cases read at a glance.
export const UI_CASES: UiCase[] = [
  { name: 'icon',
    template: () => html`<caribou-icon name="star"></caribou-icon>`,
    server: '<svg></svg>' },
  { name: 'icon, unknown name',
    template: () => html`<caribou-icon name="nope"></caribou-icon>`,
    server: '' },
  { name: 'icon button',
    template: () => html`<caribou-icon-button icon="star" label="Favourite"></caribou-icon-button>`,
    server: '<button type="button" part="button" aria-label="Favourite" title="Favourite"><caribou-icon part="icon" aria-hidden="true" name="star"></caribou-icon></button>' },
  { name: 'icon button, toggle off, with count',
    template: () => html`<caribou-icon-button icon="star" label="Favourite" pressed="false" count="3"></caribou-icon-button>`,
    server: '<button type="button" part="button" aria-label="Favourite" title="Favourite" aria-pressed="false"><caribou-icon part="icon" aria-hidden="true" name="star"></caribou-icon><span class="count" part="count">3</span></button>' },
  { name: 'icon button, pressed and disabled',
    template: () => html`<caribou-icon-button icon="bookmark" label="Bookmark" pressed ?disabled=${true}></caribou-icon-button>`,
    server: '<button type="button" part="button" aria-label="Bookmark" title="Bookmark" aria-pressed="true" disabled><caribou-icon part="icon" aria-hidden="true" name="bookmark"></caribou-icon></button>' },
  { name: 'button',
    template: () => html`<caribou-button>Cancel</caribou-button>`,
    server: '<button type="button" part="button" data-variant="secondary"><slot></slot></button>' },
  { name: 'button, primary submit, loading',
    template: () => html`<caribou-button variant="primary" type="submit" ?loading=${true}>Post</caribou-button>`,
    server: '<button type="button" part="button" data-variant="primary" aria-disabled="true" aria-busy="true"><span class="spinner" part="spinner" aria-hidden="true"></span><slot></slot></button>' },
  { name: 'button, danger, disabled',
    template: () => html`<caribou-button variant="danger" ?disabled=${true}>Delete</caribou-button>`,
    server: '<button type="button" part="button" data-variant="danger" disabled><slot></slot></button>' },
]

// The host's own shadow markup in a server render, without Lit's comment
// markers, the inlined stylesheet, or a nested element's shadow root.
export function serverShadowMarkup(out: string): string {
  const start = out.indexOf('<template')
  const bodyStart = out.indexOf('>', start) + 1
  // Walk the template tags to find the host template's own close, keeping
  // only what sits at depth 1 (the host's shadow, not a nested one).
  let depth = 1
  let kept = ''
  const tag = /<template\b[^>]*>|<\/template>/g
  tag.lastIndex = bodyStart
  let last = bodyStart
  for (let m = tag.exec(out); m; m = tag.exec(out)) {
    if (depth === 1) kept += out.slice(last, m.index)
    depth += m[0] === '</template>' ? -1 : 1
    last = m.index + m[0].length
    if (depth === 0) break
  }
  return kept
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '<svg></svg>')
    .replace(/\s+defer-hydration/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ >/g, '>')
}
