import type { AppBskyActorDefs } from '@atproto/api'
import type { Account, Relationship } from '@beatzball/caribou-mastodon-client'

/** Any of the AppView's profile views. The detailed one has counts and a banner. */
export type ProfileView =
  | AppBskyActorDefs.ProfileViewBasic
  | AppBskyActorDefs.ProfileView
  | AppBskyActorDefs.ProfileViewDetailed

/** A profile view → a Caribou `Account` (spec 6.5). Leaves `bluesky.moderation` to the caller. */
export function mapAccount(_view: ProfileView): Account {
  throw new Error('TODO(#177): mapAccount')
}

/** The profile's `viewer` → a Caribou `Relationship`, with the record URIs an undo needs. */
export function mapRelationship(_view: ProfileView): Relationship {
  throw new Error('TODO(#177): mapRelationship')
}
