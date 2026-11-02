// The /search address: `q` is the query, `type` the tab. The address is the
// one source of truth for both, so a deep link, Back and Forward all show
// the same search.
import type { SearchType } from '@beatzball/caribou-mastodon-client'
import { profilePath } from './_profile-path.js'

export const SEARCH_TABS: readonly { type: SearchType; label: string }[] = [
  { type: 'accounts', label: 'People' },
  { type: 'hashtags', label: 'Hashtags' },
  { type: 'statuses', label: 'Posts' },
]

const DEFAULT_TYPE: SearchType = 'accounts'

export interface SearchState { q: string; type: SearchType }

function isType(value: unknown): value is SearchType {
  return SEARCH_TABS.some((t) => t.type === value)
}

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v)

/** Reads the search from `location.search` or from the server's parsed query. */
export function parseSearch(source: string | Record<string, unknown>): SearchState {
  let q: unknown
  let type: unknown
  if (typeof source === 'string') {
    const params = new URLSearchParams(source)
    q = params.get('q')
    type = params.get('type')
  } else {
    q = first(source.q)
    type = first(source.type)
  }
  return { q: typeof q === 'string' ? q : '', type: isType(type) ? type : DEFAULT_TYPE }
}

/** The address of a search. People is the default tab, so it has no `type`. */
export function searchPath(q: string, type: SearchType): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (type !== DEFAULT_TYPE) params.set('type', type)
  const query = params.toString()
  return query ? `/search?${query}` : '/search'
}

/** True for a pasted web address, which the server may resolve to a post or a profile. */
export function isUrlQuery(q: string): boolean {
  const text = q.trim()
  if (!/^https?:\/\/\S+$/i.test(text)) return false
  try {
    return new URL(text).hostname.length > 0
  } catch {
    return false
  }
}

interface FoundAccount { acct: string; url?: string | null; uri?: string | null }
interface FoundStatus { id: string; url?: string | null; uri: string; account: FoundAccount }

// A username, then an optional `@domain`. Nothing that could leave the
// profile path: no `/`, `?`, `#`, empty label or leading dot.
const ACCT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(?:@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/

function validAccount(a: unknown): a is FoundAccount {
  return !!a && typeof (a as FoundAccount).acct === 'string' && ACCT.test((a as FoundAccount).acct)
}

function validStatus(s: unknown): s is FoundStatus {
  return !!s && typeof (s as FoundStatus).id === 'string' && (s as FoundStatus).id.length > 0
    && validAccount((s as FoundStatus).account)
}

function hostOf(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * The in-app page for a resolved web address: the thread of the post, or
 * the profile of the account, that the address names. Null when the answer
 * does not name one thing. `host` is the server that answered, since its
 * ids and its local accts are the ones in the result.
 *
 * A result whose `url` or `uri` is the address is that thing. A lone
 * result is taken only when it lives on the address's own server (one post
 * has several address forms there); a server that text-searched the
 * address may answer with something unrelated from elsewhere.
 */
export function resolvedPath(
  q: string,
  result: { accounts: readonly unknown[]; statuses: readonly unknown[] },
  host: string,
): string | null {
  if (!isUrlQuery(q)) return null
  const url = q.trim()
  const queryHost = hostOf(url)
  const named = (x: { url?: string | null; uri?: string | null }) => x.url === url || x.uri === url
  const local = (x: { url?: string | null; uri?: string | null }) =>
    hostOf(x.url) === queryHost || hostOf(x.uri) === queryHost
  const statuses = result.statuses.filter(validStatus)
  const accounts = result.accounts.filter(validAccount)
  const lone = <T extends { url?: string | null; uri?: string | null }>(list: T[], others: unknown[]) =>
    list.length === 1 && others.length === 0 && local(list[0]!) ? list[0] : undefined
  const status = statuses.find(named) ?? lone(statuses, accounts)
  if (status) return `${profilePath(status.account.acct, host)}/${encodeURIComponent(status.id)}`
  const account = accounts.find(named) ?? lone(accounts, statuses)
  if (account) return profilePath(account.acct, host)
  return null
}
