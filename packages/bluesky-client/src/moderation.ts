import type {
  AppBskyActorDefs, AppBskyFeedDefs, InterpretedLabelValueDefinition, ModerationPrefs,
} from '@atproto/api'
import type { BlueskyModerationResult } from '@beatzball/caribou-mastodon-client'

/** Which SDK function to run: a post (`moderatePost`) or a profile (`moderateProfile`). */
export type ModerationSubject =
  | { kind: 'post'; view: AppBskyFeedDefs.PostView }
  | { kind: 'profile'; view: AppBskyActorDefs.ProfileViewBasic }

/**
 * Runs the SDK's moderation and flattens the decision to plain data, one
 * entry per context (spec 7.4). The SDK's class instance never leaves this
 * function. Not server-safe for the browser: it imports `@atproto/api`, so
 * the client loads it only through a dynamic `import()` (the `bsky` chunk).
 */
export function moderate(
  _subject: ModerationSubject,
  _userDid: string | undefined,
  _prefs: ModerationPrefs,
  _labelDefs: Record<string, InterpretedLabelValueDefinition[]>,
): BlueskyModerationResult {
  throw new Error('TODO(#180): moderate')
}
