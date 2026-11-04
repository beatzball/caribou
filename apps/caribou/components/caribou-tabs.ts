import { LitElement, html, css, nothing, type PropertyValues } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { devWarn } from './_dev-warn.js'

// A row of tabs that are links: each tab is its own address.
//
//   <caribou-tabs label="Result type" fill>
//     <a href="/search?q=x" aria-current="page" @click=${…}>People</a>
//     <a href="/search?q=x&type=hashtags" @click=${…}>Hashtags</a>
//   </caribou-tabs>
//
// Links, not an ARIA tablist. Every caller is driven by the address: a tab
// opens in a new tab, can be copied, works with JavaScript off and goes
// through Back and Forward. A tablist promises a tab panel in the same page
// and arrow-key focus, which a link to another address does not have.
//
// The links are the caller's own light DOM, slotted into a `<nav>` here.
// So the caller sets `aria-current="page"` on the active one, binds its
// click handler (`spaClick`, or its own), and its tests keep finding them;
// none of that could reach an anchor inside this element's shadow root.
// The server renders the `<nav>` as declarative shadow DOM, so the row
// looks the same before the client loads, and without it.
//
// `label` names the navigation landmark. `fill` shares the width between
// the tabs; without it each tab is as wide as its text. On a narrow screen
// the row scrolls sideways instead of widening the page.
//
// Parts: `nav`.
@customElement('caribou-tabs')
export class CaribouTabs extends LitElement {
  static override styles = css`
    :host { display: block; min-inline-size: 0; max-inline-size: 100%; border-bottom: 1px solid var(--border); }
    :host([hidden]) { display: none; }
    nav {
      display: flex; overflow-x: auto; overscroll-behavior-x: contain;
      scrollbar-width: none;
      /* The cue that more tabs are off screen, with no scrollbar and no
         JavaScript: a shadow at each edge that stays put, under a cover in
         the page colour that scrolls with the tabs. At the start of the row
         the left cover hides the left shadow; at the end, the right one.
         A row that fits shows neither. */
      --_shade: color-mix(in srgb, var(--fg-0) 35%, transparent);
      background:
        linear-gradient(to right, var(--bg-0) 40%, transparent) left / 2rem 100% no-repeat local,
        linear-gradient(to left, var(--bg-0) 40%, transparent) right / 2rem 100% no-repeat local,
        linear-gradient(to right, var(--_shade), transparent) left / 1rem 100% no-repeat scroll,
        linear-gradient(to left, var(--_shade), transparent) right / 1rem 100% no-repeat scroll;
      background-color: var(--bg-0);
    }
    nav::-webkit-scrollbar { display: none; }
    ::slotted(a) {
      box-sizing: border-box; flex: none; display: flex; align-items: center; justify-content: center;
      min-block-size: 44px; padding: var(--space-3) var(--space-4);
      color: var(--fg-1); text-decoration: none; white-space: nowrap;
    }
    :host([fill]) ::slotted(a) { flex: 1 1 0%; padding-inline: var(--space-2); }
    ::slotted(a:hover) { color: var(--fg-0); background: var(--bg-1); }
    /* Inset, so the ring is not cut off by the scrolling row. */
    ::slotted(a:focus-visible) { outline: 2px solid var(--accent); outline-offset: -2px; }
    ::slotted(a[aria-current="page"]) {
      color: var(--fg-0); font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent);
    }
  `

  @property() label = ''
  @property({ type: Boolean, reflect: true }) fill = false

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has('label') && !this.label) devWarn('<caribou-tabs>: a label is required.')
  }

  override render() {
    return html`<nav part="nav" aria-label=${this.label || nothing}><slot></slot></nav>`
  }
}

declare global {
  interface HTMLElementTagNameMap { 'caribou-tabs': CaribouTabs }
}
