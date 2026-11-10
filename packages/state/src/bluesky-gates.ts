// Reply and quote limits for a new Bluesky post (#199). Rules: README,
// "Reply and quote limits" (G1 to G6).
import type { BlueskyGates, BlueskyReplyRule } from '@beatzball/caribou-mastodon-client'
import type { BlueskyDraft } from './compose.js'

/** Everyone can reply, quotes on: no gate records (G2). */
export const BLUESKY_DEFAULT_GATES: BlueskyGates = Object.freeze({ replies: null, quotes: true }) as BlueskyGates

// G5: the order rules are sent and said in.
const ORDER: BlueskyReplyRule['kind'][] = ['mention', 'following', 'follower', 'list']

function sorted(rules: BlueskyReplyRule[]): BlueskyReplyRule[] {
  return [...rules].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
}

function sameRule(a: BlueskyReplyRule, b: BlueskyReplyRule): boolean {
  return a.kind === b.kind && (a.kind !== 'list' || a.id === (b as { id: string }).id)
}

/** "Everyone" or "Nobody" (G5). */
export function setBlueskyReplies(g: BlueskyGates, to: 'everyone' | 'nobody'): BlueskyGates {
  return { ...g, replies: to === 'everyone' ? null : [] }
}

/**
 * Turns one rule on or off (G5). On from everyone or nobody starts from that
 * rule; another list takes the place of the one there; off for the last
 * rule is everyone.
 */
export function toggleBlueskyReplyRule(g: BlueskyGates, rule: BlueskyReplyRule): BlueskyGates {
  const now = g.replies ?? []
  if (now.some((r) => sameRule(r, rule))) {
    const left = now.filter((r) => !sameRule(r, rule))
    return { ...g, replies: left.length > 0 ? left : null }
  }
  const kept = rule.kind === 'list' ? now.filter((r) => r.kind !== 'list') : now
  return { ...g, replies: sorted([...kept, rule]) }
}

export function setBlueskyQuotes(g: BlueskyGates, quotes: boolean): BlueskyGates {
  return { ...g, quotes }
}

/**
 * The limits a draft's send writes, or `null` for none: a reply (G1) or the
 * default (G2). In order, with no list titles (they are not sent).
 */
export function blueskySentGates(b: BlueskyDraft): BlueskyGates | null {
  const g = b.gates
  if (b.reply || !g || (g.replies === null && g.quotes)) return null
  return {
    replies: g.replies === null ? null : sorted(g.replies).map((r) => r.kind === 'list' ? { kind: 'list', id: r.id } : { kind: r.kind }),
    quotes: g.quotes,
  }
}

function ruleText(r: BlueskyReplyRule): string {
  switch (r.kind) {
    case 'mention': return 'people you mention'
    case 'following': return 'people you follow'
    case 'follower': return 'your followers'
    case 'list': return r.title ? `people on ${r.title}` : 'people on your list'
  }
}

/** The limit in plain words (G6). */
export function blueskyGatesText(g: BlueskyGates | null | undefined): string {
  const replies = g?.replies ?? null
  const who = replies === null ? 'Everyone can reply.'
    : replies.length === 0 ? 'Nobody can reply.'
    : `Only ${joinAnd(sorted(replies).map(ruleText))} can reply.`
  return `${who} ${g?.quotes === false ? 'Quotes are off.' : 'Quotes are on.'}`
}

function joinAnd(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
