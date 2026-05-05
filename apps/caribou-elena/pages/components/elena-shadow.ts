import {
  Elena as UpstreamElena,
  type ElenaConstructor,
  type ElenaElementConstructor,
} from '@elenajs/core'

const SENTINEL_TAG = 'STYLE'
const SENTINEL_ID = 'caribou-dsd-style'

/**
 * Caribou's shadow-DOM-aware Elena wrapper. Adds the §6.5 / §6.6
 * adoption-suppression contract on top of `@elenajs/core`'s `Elena()`:
 *
 *   When upgrading a DSD-prerendered host whose shadow root already has
 *   `<style id="caribou-dsd-style">` as its first child, skip the
 *   `adoptedStyleSheets` adoption path. The inline `<style>` *is* the
 *   authoritative stylesheet at hydration time — running adoption on top
 *   would (a) duplicate the rules and (b) defeat zero-FOUC by briefly
 *   running unstyled while the constructable sheet is built.
 *
 * Caribou shadow-DOM components must use this wrapper instead of
 * `Elena()` directly. Components that don't use `static shadow` (light-DOM
 * pages) can keep using upstream `Elena()` — the wrapper is a no-op for
 * them.
 *
 * Trade-off: we reach into a private upstream method (`_attachShadow`).
 * If a future Elena version renames or refactors that method, this
 * wrapper breaks at runtime. The alternative — fork `@elenajs/core` —
 * is worse: it leaves us maintaining the entire library. The narrow
 * override is the smaller surface to maintain.
 */
export function CaribouElena(superClass: ElenaConstructor): ElenaElementConstructor {
  const Base = UpstreamElena(superClass)

  class CaribouShadowElena extends Base {
    // _attachShadow is an internal underscore-prefixed method on upstream
    // Elena. Not on the public type, but JavaScript dispatch picks it up
    // via the prototype chain. Override via super dispatch so test spies
    // on the upstream prototype still observe fall-through.
    _attachShadow() {
      const ctor = this.constructor as { shadow?: 'open' | 'closed' }
      if (ctor.shadow && this.shadowRoot) {
        const first = this.shadowRoot.firstElementChild
        if (
          first &&
          first.tagName === SENTINEL_TAG &&
          (first as HTMLStyleElement).id === SENTINEL_ID
        ) {
          // Sentinel detected → DSD already provided the authoritative
          // stylesheet. Suppress upstream's `adoptedStyleSheets` write.
          return
        }
      }
      // @ts-expect-error — calling upstream's internal _attachShadow via
      // super dispatch. See class-decl @ts-expect-error above for rationale.
      super._attachShadow()
    }
  }

  return CaribouShadowElena as unknown as ElenaElementConstructor
}
