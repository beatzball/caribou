import { ROUTE_ALIAS_EVENT } from './_bluesky-route.js'
import type { CaribouStatusCard } from './caribou-status-card.js'
import { routeTitle, threadTitleName } from './_route-title.js'

// Follow only the components that can refine a title. In particular, do not
// observe entire timelines or their cards on every clock/count update.
// Keep caribou-search here: typing changes the query with pushState or
// replaceState without popstate; its result render triggers the title update.
const TITLE_COMPONENTS = 'caribou-profile, caribou-profile-header, caribou-list-header, caribou-thread, caribou-status-card[variant="focused"], caribou-search'

/** One lifecycle for the tab. Runs outside Lit templates, after hydration. */
export function startRouteTitles(outlet: Element): () => void {
  const owners = new WeakMap<Element, string>()
  const path = (pathname = location.pathname) => pathname.replace(/\/+$/, '') || '/'
  let current: Element | null = null
  let observed = new Set<Node>()
  const content = new MutationObserver(refresh)
  const observe = (root: Node) => {
    if (observed.has(root)) return
    observed.add(root)
    content.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] })
  }
  const roots = (element: Element, found: ShadowRoot[] = []): ShadowRoot[] => {
    if (!element.shadowRoot) return found
    found.push(element.shadowRoot)
    observe(element.shadowRoot)
    for (const child of element.shadowRoot.querySelectorAll(TITLE_COMPONENTS)) roots(child, found)
    return found
  }
  function refresh() {
    // Newly appended pages belong to the address the router is resolving.
    for (const page of outlet.children) {
      if (!owners.has(page)) owners.set(page, path())
    }
    const page = [...outlet.children].find((el) => !el.hasAttribute('hidden') && owners.get(el) === path()) ?? null
    if (page !== current) {
      content.disconnect()
      observed = new Set()
      current = page
    }
    let name: string | undefined
    if (page?.isConnected) {
      const all = roots(page)
      const profile = all.find((root) => root.host.localName === 'caribou-profile-header')
      const list = all.find((root) => root.host.localName === 'caribou-list-header')
      const focused = all.find((root) => root.host.localName === 'caribou-status-card')
      // Read rendered identity, never an account/store field: moderation
      // removes covered identity from these nodes until the reader reveals it.
      name = profile?.querySelector('h1')?.textContent?.trim()
        || list?.querySelector('h1[data-list-title]')?.textContent?.trim()
        || (threadTitleName((focused?.host as CaribouStatusCard | undefined)?.status ?? undefined)
          ? focused?.querySelector('.author strong')?.textContent?.trim() : undefined)
        || undefined
    }
    document.title = routeTitle(new URL(location.href), name)
  }
  // Attribute changes include the router revealing its prepared page. This
  // observer runs before its queued announcement reads document.title.
  const pages = new MutationObserver(refresh)
  pages.observe(outlet, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
  const alias = (event: Event) => {
    const { from, to } = (event as CustomEvent<{ from: string; to: string }>).detail
    for (const page of outlet.children) {
      if (owners.get(page) === path(from)) owners.set(page, path(to))
    }
    refresh()
  }
  window.addEventListener(ROUTE_ALIAS_EVENT, alias)
  window.addEventListener('popstate', refresh)
  refresh()
  return () => {
    pages.disconnect()
    content.disconnect()
    window.removeEventListener('popstate', refresh)
    window.removeEventListener(ROUTE_ALIAS_EVENT, alias)
  }
}
