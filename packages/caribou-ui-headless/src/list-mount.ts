/**
 * Morph-opaque container for keyed-list reconciliation.
 *
 * Elena's morphContent recurses into native children (per the morph
 * spec README), so a host that renders <ul></ul> empty in its template
 * will have morph wipe any imperatively-added <li> children on the
 * next host re-render. This element sidesteps that by placing the
 * <ul> inside its own shadow root — morph never crosses a shadow
 * boundary (per morph-custom-elements.test.ts §1).
 *
 * Hosts render <caribou-list-mount></caribou-list-mount> empty in their
 * template. The keyed reconciler operates against `mount.mountUl`.
 *
 * Plain HTMLElement; no Elena dependency. Adapter-portable for
 * future caribou-lit / caribou-fast.
 */
export class CaribouListMount extends HTMLElement {
  private _ul: HTMLUListElement | null = null

  connectedCallback(): void {
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = ':host { display: block }'
      const ul = document.createElement('ul')
      ul.style.listStyle = 'none'
      ul.style.margin = '0'
      ul.style.padding = '0'
      shadow.append(style, ul)
      this._ul = ul
    } else if (!this._ul) {
      this._ul = this.shadowRoot.querySelector('ul')
    }
  }

  /**
   * Returns the inner <ul> that the keyed reconciler should target.
   * Defensive: if accessed before connectedCallback fires, forces a
   * synchronous mount so the caller never sees null.
   */
  get mountUl(): HTMLUListElement {
    if (!this._ul) this.connectedCallback()
    return this._ul!
  }
}

if (!customElements.get('caribou-list-mount')) {
  customElements.define('caribou-list-mount', CaribouListMount)
}
