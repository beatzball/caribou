// Renders an Elena shadow-DOM custom element to its declarative-shadow-DOM
// SSR string. This helper is the gate for §12.6 hydration parity: every
// shadow-DOM SSR test in Caribou — and every server-rendered page that
// embeds a shadow-DOM component — funnels through this function so server
// output and client `render()` output are byte-equal by construction.
//
// The wrapped HTML shape:
//
//   <{tag} {…attrs}>
//     <template shadowrootmode="open">
//       <style id="caribou-dsd-style">{static styles…}</style>
//       {render() result…}
//     </template>
//   </{tag}>
//
// The `<style id="caribou-dsd-style">` sentinel is the adoption-suppression
// contract: when Elena upgrades a DSD-mounted instance and finds this
// sentinel as the first child of the shadow root, it must skip the
// `adoptedStyleSheets` adoption path. The inline <style> *is* the
// authoritative stylesheet at hydration time; running adoption on top
// would duplicate the rules and (more importantly) defeat zero-FOUC by
// briefly running unstyled while the constructable sheet is built.

const SENTINEL_ID = 'caribou-dsd-style'

interface ElenaCtorStatics {
  tagName?: string
  styles?: string | string[] | CSSStyleSheet | (string | CSSStyleSheet)[]
}

type ElenaInstance = HTMLElement & { render: () => unknown }

export interface AttrsAndProps {
  attrs?: Record<string, string | null | undefined>
  props?: Record<string, unknown>
}

type RenderArg =
  | Record<string, string | null | undefined>
  | AttrsAndProps

function isAttrsAndProps(arg: RenderArg): arg is AttrsAndProps {
  if (typeof arg !== 'object' || arg === null) return false
  const keys = Object.keys(arg)
  // Detection rule: explicit new form iff every enumerable key is one of
  // {attrs, props}. Empty objects are treated as new form (vacuously
  // true — both interpretations produce the same empty output).
  return keys.every((k) => k === 'attrs' || k === 'props')
}

function getClass(tagName: string): (new () => ElenaInstance) | null {
  const ce = (globalThis as { customElements?: CustomElementRegistry }).customElements
  return (ce?.get(tagName) as (new () => ElenaInstance) | undefined) ?? null
}

interface TemplateResult {
  strings: ArrayLike<string>
  values: readonly unknown[]
}

function isTemplateResult(x: unknown): x is TemplateResult {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return Array.isArray(o.values) && o.strings != null && typeof (o.strings as ArrayLike<string>).length === 'number'
}

function renderTemplate(tpl: unknown): string {
  if (tpl == null || tpl === false || tpl === true) return ''
  if (typeof tpl === 'string') return tpl
  if (typeof tpl === 'number') return String(tpl)
  if (Array.isArray(tpl)) return tpl.map(renderTemplate).join('')
  if (isTemplateResult(tpl)) {
    const { strings, values } = tpl
    let out = ''
    for (let i = 0; i < strings.length; i++) {
      out += strings[i]
      if (i < values.length) out += renderTemplate(values[i])
    }
    return out
  }
  return String(tpl)
}

function escAttr(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function flattenStyles(styles: ElenaCtorStatics['styles']): string {
  if (styles == null) return ''
  const list = Array.isArray(styles) ? styles : [styles]
  // CSSStyleSheet instances don't exist on the SSR side (no constructable
  // stylesheet platform), so we skip them here. Caribou components author
  // styles as strings for exactly this reason.
  return list.filter((s): s is string => typeof s === 'string').join('\n')
}

/**
 * Render a registered Elena shadow-DOM component to its DSD HTML string.
 *
 * @param tagName  Custom-element tag (must be defined in `customElements`).
 * @param arg      Public attribute/property bag. Can be:
 *                 1. New form: `{ attrs?: {...}, props?: {...} }` — attrs are
 *                    reflected as host attributes AND assigned to the instance;
 *                    props are assigned to the instance only.
 *                 2. Legacy form: `Record<string, string|null|undefined>` —
 *                    treated as attrs (reflected and assigned).
 *                 Non-null entries are assigned to the instance before
 *                 `render()` runs. Pass `null`/`undefined` to omit a slot.
 */
export async function renderShadowComponentToString(
  tagName: string,
  arg: RenderArg = {},
): Promise<string> {
  const Cls = getClass(tagName)
  if (!Cls) {
    throw new Error(`renderShadowComponentToString: unknown tag "${tagName}" — did the component module load?`)
  }

  let attrs: Record<string, string | null | undefined>
  let props: Record<string, unknown>
  if (isAttrsAndProps(arg)) {
    attrs = arg.attrs ?? {}
    props = arg.props ?? {}
  } else {
    attrs = arg
    props = {}
  }

  const instance = new Cls()

  // Assign attrs to the instance (so render() sees them as properties)
  // AND reflect them as host attributes in the output.
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue
    ;(instance as unknown as Record<string, unknown>)[k] = v
  }

  // Assign props to the instance ONLY (no attribute reflection).
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue
    ;(instance as unknown as Record<string, unknown>)[k] = v
  }

  const tpl = instance.render()
  const inner = renderTemplate(tpl)

  const stylesText = flattenStyles((Cls as unknown as ElenaCtorStatics).styles)

  const attrEntries = Object.entries(attrs)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join('')

  return (
    `<${tagName}${attrEntries}>` +
    `<template shadowrootmode="open">` +
    `<style id="${SENTINEL_ID}">${stylesText}</style>` +
    inner +
    `</template>` +
    `</${tagName}>`
  )
}

/**
 * Alias used by §10.2 / §12.6 byte-equal hydration parity tests. Both the
 * "server render" and "client render in pre-hydration mode" paths funnel
 * through the same helper so the comparison is apples-to-apples.
 */
export const renderComponentToString = renderShadowComponentToString
