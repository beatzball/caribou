import type { H3Event } from 'h3'
import type { Account, Status } from '@beatzball/caribou-mastodon-client'
import { routeTitle } from '../../components/_route-title.js'

export const escapeTitle = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function visibleAccountName(account?: Account): string | undefined {
  if (!account) return undefined
  if (account.bluesky) {
    const view = account.bluesky.moderation?.contexts.profileView
    if (!view || view.blur || view.filter) return undefined
  }
  return account.displayName || account.username || undefined
}

export function serverRouteTitle(url: URL, data: Record<string, unknown>): string {
  const account = data.account as Account | undefined
  const focused = data.focused as Status | undefined
  let name = data.kind === 'ok' ? visibleAccountName(account) : undefined
  if (data.kind === 'ok' && focused) {
    const view = focused.bluesky?.moderation?.contexts.contentView
    if (!focused.bluesky || (view && !view.blur && !view.filter)) name = visibleAccountName(focused.account)
  }
  return escapeTitle(routeTitle(url, name))
}

// Litro extracts seoTitle before serializing the data. Keep that boundary
// shared too, without extra fetches or browser-only imports.
export function withRouteTitle(module: Record<string, unknown>, url: URL): Record<string, unknown> {
  const pageData = module.pageData as { __litroPageData?: boolean; fetcher: (event: H3Event) => Promise<Record<string, unknown>> } | undefined
  if (!pageData?.__litroPageData) return module
  return {
    ...module,
    pageData: {
      ...pageData,
      fetcher: async (event: H3Event) => {
        const data = await pageData.fetcher(event)
        return { ...data, seoTitle: serverRouteTitle(url, data) }
      },
    },
  }
}
