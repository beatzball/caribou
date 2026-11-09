import type { AppBskyActorDefs } from '@atproto/api'
import type { Account, Relationship } from '@beatzball/caribou-mastodon-client'
import { renderFacets } from '../facets.js'
import { mapLabels } from './labels.js'

/** Any of the AppView's profile views. The detailed one has counts and a banner. */
export type ProfileView =
  | AppBskyActorDefs.ProfileViewBasic
  | AppBskyActorDefs.ProfileView
  | AppBskyActorDefs.ProfileViewDetailed

/** The handle the AppView sends when it could not verify the real one. */
export const INVALID_HANDLE = 'handle.invalid'

function field<K extends string>(view: object, key: K): unknown {
  return (view as Partial<Record<K, unknown>>)[key]
}

function text(view: object, key: string): string {
  const v = field(view, key)
  return typeof v === 'string' ? v : ''
}

function count(view: object, key: string): number {
  const v = field(view, key)
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * A profile view → a Caribou `Account` (spec 6.5; rules in the README).
 * Leaves `bluesky.moderation` to the caller.
 */
export function mapAccount(view: ProfileView): Account {
  const handleInvalid = view.handle === INVALID_HANDLE
  const description = text(view, 'description')
  const avatar = view.avatar ?? ''
  const banner = text(view, 'banner')
  return {
    id: view.did,
    username: view.handle,
    acct: view.handle,
    url: `https://bsky.app/profile/${handleInvalid ? view.did : view.handle}`,
    displayName: view.displayName ?? '',
    note: description ? renderFacets(description, []) : '',
    avatar,
    avatarStatic: avatar,
    header: banner,
    headerStatic: banner,
    locked: false,
    fields: [],
    emojis: [],
    bot: false,
    group: false,
    createdAt: view.createdAt ?? text(view, 'indexedAt'),
    lastStatusAt: null,
    statusesCount: count(view, 'postsCount'),
    followersCount: count(view, 'followersCount'),
    followingCount: count(view, 'followsCount'),
    roles: [],
    bluesky: { did: view.did, handleInvalid, labels: mapLabels(view.labels) },
  }
}

/**
 * The profile's `viewer` → a Caribou `Relationship`, with the record URIs an
 * undo needs. A block or mute by list counts as one. For a list's block the
 * AppView puts the list's URI in `viewer.blocking`, so `blockUri` keeps only
 * a block record's URI: the reader undoes a list's block on the list.
 *
 * While either side blocks, the AppView hides the follow, but the follow
 * record stays. So `following` and `followUri` are left out (unknown) then
 * (state README, R2-1): a block says nothing about the follow.
 */
export function mapRelationship(view: ProfileView): Relationship {
  const v = view.viewer ?? {}
  const muting = v.muted === true
  // at://<did>/<collection>/<rkey>
  const blockRecord = v.blocking?.split('/')[3] === 'app.bsky.graph.block' ? v.blocking : null
  const followHidden = v.blocking != null || v.blockingByList != null || v.blockedBy === true
  const rel: Relationship = {
    id: view.did,
    following: v.following != null,
    showingReblogs: v.mutedOnlyReposts !== true,
    notifying: false,
    followedBy: v.followedBy != null,
    blocking: v.blocking != null || v.blockingByList != null,
    blockedBy: v.blockedBy === true,
    muting,
    mutingNotifications: muting,
    requested: false,
    domainBlocking: false,
    endorsed: false,
    note: null,
    requestedBy: false,
    bluesky: {
      followUri: v.following ?? null,
      blockUri: blockRecord,
      blockingByList: v.blockingByList?.uri ?? null,
      mutingByList: v.mutedByList?.uri ?? null,
    },
  }
  if (followHidden && v.following == null) {
    delete (rel as Partial<Relationship>).following
    delete (rel.bluesky as Partial<NonNullable<Relationship['bluesky']>>).followUri
  }
  return rel
}
