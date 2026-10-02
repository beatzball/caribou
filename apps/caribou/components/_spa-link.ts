// Click handler that turns a plain same-origin `<a href>` into a client-side
// navigation. Bind it with `@click=${spaClick}` on the anchor.
//
// `<litro-link>` is the default choice for a link. Use this instead when the
// real anchor has to carry state of its own — `aria-current`, a class the
// component styles — because `<litro-link>` keeps its anchor in a shadow root
// and forwards only `href`, `target` and `rel` to it.
//
// The anchor stays a real link: without JavaScript, or before the component
// hydrates, the browser follows the href as a full page load.
export function spaClick(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0) return
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = e.currentTarget as HTMLAnchorElement
  const href = a.getAttribute('href') ?? ''
  if (a.target || !href.startsWith('/')) return
  e.preventDefault()
  void import('@beatzball/litro-router').then(({ LitroRouter }) => LitroRouter.go(href))
}
