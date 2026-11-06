/**
 * How the Mastodon client maps masto's types into Caribou's own types.
 *
 * Caribou's types keep Mastodon's field names and shapes, so a masto object
 * already is a Caribou object: the mapping does nothing at run time. These
 * checks make that a compile-time fact. When a masto upgrade changes a shape
 * so that it no longer fits, `pnpm typecheck` fails here, at the boundary,
 * not in some screen far away.
 *
 * Only this file and `create-client.ts` may name masto's types (see
 * `__tests__/owned-types-boundary.test.ts`).
 */
import type { mastodon } from 'masto'
import type * as Caribou from './types.js'

// masto 7.10.2 declares `emojis` on each poll option. The Mastodon API puts
// it on the poll (https://docs.joinmastodon.org/entities/Poll/#emojis), so
// the object masto hands back has it there. This corrects masto's
// declaration to match the wire, in this one place, so the `Fits` check
// below stays honest. Drop it once masto fixes its type.
declare module 'masto/mastodon/entities/v1/poll.js' {
  interface Poll {
    emojis: mastodon.v1.CustomEmoji[]
  }
}

/** Fails to compile unless `From` can be used where `To` is expected. */
type Fits<From extends To, To> = [From, To]

export type MastoMappingChecks = [
  Fits<mastodon.v1.Account, Caribou.Account>,
  Fits<mastodon.v1.AccountCredentials, Caribou.AccountCredentials>,
  Fits<mastodon.v1.Status, Caribou.Status>,
  Fits<mastodon.v1.StatusEdit, Caribou.StatusEdit>,
  Fits<mastodon.v1.StatusSource, Caribou.StatusSource>,
  Fits<mastodon.v1.MediaAttachment, Caribou.MediaAttachment>,
  Fits<mastodon.v1.Poll, Caribou.Poll>,
  Fits<mastodon.v1.PreviewCard, Caribou.PreviewCard>,
  Fits<mastodon.v1.Tag, Caribou.Tag>,
  Fits<mastodon.v1.FilterResult, Caribou.FilterResult>,
  Fits<mastodon.v2.Filter, Caribou.Filter>,
  Fits<mastodon.v1.Relationship, Caribou.Relationship>,
  Fits<mastodon.v1.List, Caribou.List>,
  Fits<mastodon.v1.Notification, Caribou.Notification>,
  Fits<mastodon.v1.NotificationType, Caribou.NotificationType>,
  Fits<mastodon.v2.Search, Caribou.Search>,
  Fits<mastodon.v2.Instance, Caribou.Instance>,
  // Inputs go the other way: a Caribou value is sent to masto as it is.
  Fits<Caribou.StatusVisibility, mastodon.v1.StatusVisibility>,
  Fits<Caribou.ListRepliesPolicy, mastodon.v1.ListRepliesPolicy>,
  Fits<Caribou.NotificationType, mastodon.v1.NotificationType>,
]
