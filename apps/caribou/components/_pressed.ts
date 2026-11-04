import type { PropertyDeclaration } from 'lit'

// `pressed` has three states. No attribute: not a toggle, so no
// `aria-pressed` at all. `pressed="false"`: a toggle that is off, which a
// screen reader must hear as "not pressed". `pressed` or `pressed="true"`:
// on. A plain boolean attribute cannot tell the first two apart.
export const pressedConverter: PropertyDeclaration['converter'] = {
  fromAttribute: (v: string | null) => v === null ? undefined : v !== 'false',
  toAttribute: (v: boolean | undefined) => v === undefined ? null : String(v),
}
