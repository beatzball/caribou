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
 * @param props    Public attribute/property bag. Non-null entries are
 *                 (a) assigned to the instance before `render()` runs, and
 *                 (b) reflected as host-element attributes in the output.
 *                 Pass `null`/`undefined` to omit a slot.
 */
export async function renderShadowComponentToString(
  tagName: string,
  props: Record<string, string | null | undefined>,
): Promise<string> {
  const Cls = getClass(tagName)
  if (!Cls) {
    throw new Error(`renderShadowComponentToString: unknown tag "${tagName}" — did the component module load?`)
  }

  const instance = new Cls()
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue
    ;(instance as unknown as Record<string, unknown>)[k] = v
  }

  const tpl = instance.render()
  const inner = renderTemplate(tpl)

  const stylesText = flattenStyles((Cls as unknown as ElenaCtorStatics).styles)

  const attrs = Object.entries(props)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join('')

  return (
    `<${tagName}${attrs}>` +
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
