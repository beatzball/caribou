/**
 * Caribou's own data types.
 *
 * Screens, stores and SSR code name these, never masto's types. They keep
 * Mastodon's field names, so `status.favouritesCount` reads the same as it
 * always has. They are recursive: `Status.account` is a Caribou `Account`
 * and `Status.reblog` a Caribou `Status`.
 *
 * A network client maps its own data into these shapes. The Mastodon client
 * does it with no work at run time: masto's objects already have this shape,
 * and `masto-mapping.ts` checks that at compile time. A field that only one
 * network has goes in that network's optional field (`bluesky`), not in a new
 * top-level field.
 *
 * This file imports nothing, so a client for another network can use it
 * without pulling in masto.
 */

// ---------------------------------------------------------------- shared

export interface CustomEmoji {
  shortcode: string
  url: string
  staticUrl: string
  visibleInPicker: boolean
  category?: string | null
}

export type StatusVisibility = 'public' | 'unlisted' | 'private' | 'direct'

// --------------------------------------------------------------- account

export interface Role {
  id: number
  name: string
  color: string
  position: number
  permissions: number
  highlighted: boolean
  createdAt: string
  updatedAt: string
}

export interface AccountField {
  name: string
  value: string
  verifiedAt?: string | null
}

export interface Account {
  id: string
  username: string
  acct: string
  url: string
  displayName: string
  note: string
  avatar: string
  avatarStatic: string
  header: string
  headerStatic: string
  locked: boolean
  fields: AccountField[]
  emojis: CustomEmoji[]
  bot: boolean
  group: boolean
  discoverable?: boolean | null
  noindex?: boolean | null
  moved?: Account | null
  suspended?: boolean | null
  limited?: boolean | null
  createdAt: string
  /** Null for an account that has never posted. */
  lastStatusAt?: string | null
  statusesCount: number
  followersCount: number
  followingCount: number
  roles: Pick<Role, 'id' | 'name' | 'color'>[]
  memorial?: boolean | null
}

/** Who may quote the reader's posts, as the reader set it. */
export type QuotePolicy = 'public' | 'followers' | 'nobody'

export interface AccountSource {
  attributionDomains: string[]
  note: string
  fields: AccountField[]
  privacy?: StatusVisibility | null
  sensitive?: boolean | null
  language: string | null
  followRequestsCount?: number | null
  hideCollections?: boolean | null
  discoverable?: boolean | null
  indexable: boolean
  quotePolicy: QuotePolicy
  role: Role
}

/** The signed-in reader's own account, with its settings. */
export interface AccountCredentials extends Account {
  source: AccountSource
  role: Role
}

// ------------------------------------------------------- status leaf types

export type MediaAttachmentType = 'image' | 'video' | 'gifv' | 'audio' | 'unknown'

export interface MediaAttachmentMetaImage {
  width: number
  height: number
  size: string
  aspect: number
}

export interface MediaAttachmentMetaVideo {
  width: number
  height: number
  frameRate: string
  duration: number
  bitrate: number
  aspect: number
}

export interface MediaAttachmentMeta {
  small?: MediaAttachmentMetaImage | MediaAttachmentMetaVideo | null
  original?: MediaAttachmentMetaImage | MediaAttachmentMetaVideo | null
  focus?: { x: number; y: number } | null
  colors?: { background: string; foreground: string; accent: string } | null
}

export interface MediaAttachment {
  id: string
  type: MediaAttachmentType
  url?: string | null
  previewUrl?: string | null
  remoteUrl?: string | null
  previewRemoteUrl?: string | null
  textUrl?: string | null
  meta?: MediaAttachmentMeta | null
  description?: string | null
  blurhash?: string | null
}

export interface PollOption {
  title: string
  /** Null while the results are hidden. */
  votesCount?: number | null
}

export interface Poll {
  id: string
  expiresAt?: string | null
  expired: boolean
  multiple: boolean
  votesCount: number
  votersCount?: number | null
  voted?: boolean
  ownVotes?: number[] | null
  options: PollOption[]
  /** The custom emoji used in the option titles. */
  emojis: CustomEmoji[]
}

export type PreviewCardType = 'link' | 'photo' | 'video' | 'rich'

export interface PreviewCardAuthor {
  name: string
  url: string
  account: Account | null
}

/** A link card. */
export interface PreviewCard {
  url: string
  title: string
  description: string
  type: PreviewCardType
  blurhash?: string | null
  authors: PreviewCardAuthor[]
  authorName?: string | null
  authorUrl?: string | null
  providerName?: string | null
  providerUrl?: string | null
  html?: string | null
  width?: number | null
  height?: number | null
  image?: string | null
  embedUrl: string
  language?: string
}

export interface TagHistory {
  day: string
  uses: string
  accounts: string
}

/** A hashtag. `following` says whether the reader follows it. */
export interface Tag {
  id: string
  name: string
  url: string
  history?: TagHistory[] | null
  following?: boolean | null
  featuring?: boolean | null
}

export interface StatusMention {
  id: string
  username: string
  url: string
  acct: string
}

export interface Application {
  name: string
  website?: string | null
  scopes?: string[] | null
  redirectUris?: string[] | null
  vapidKey?: string | null
}

// ---------------------------------------------------------------- filters

export type FilterContext = 'home' | 'notifications' | 'public' | 'thread' | 'account'
export type FilterAction = 'warn' | 'hide' | 'blur'

export interface FilterKeyword {
  id: string
  keyword: string
  wholeWord: boolean
}

export interface FilterStatus {
  id: string
  statusId: string
}

/** One of the reader's server-side filters (Mastodon filters v2). */
export interface Filter {
  id: string
  title: string
  context: FilterContext[]
  expiresAt?: string | null
  filterAction: FilterAction
  keywords: FilterKeyword[]
  statuses: FilterStatus[]
}

/** Why a filter matched a post. */
export interface FilterResult {
  filter: Filter
  keywordMatches: string[] | null
  statusMatches: string[] | null
}

// ----------------------------------------------------------------- quotes

export type QuoteState =
  | 'pending' | 'accepted' | 'rejected' | 'revoked' | 'deleted'
  | 'unauthorized' | 'blocked_account' | 'blocked_domain' | 'muted_account'

/** A quote with the quoted post in it. */
export interface Quote {
  state: QuoteState
  quotedStatus?: Status | null
}

/** A quote that names the quoted post by id only. */
export interface ShallowQuote {
  state: QuoteState
  quotedStatusId?: string | null
}

export type QuoteApprovalPolicy = 'public' | 'followers' | 'following' | 'unsupported_policy'

/** Who may quote a post, as the server reports it. */
export interface QuoteApproval {
  automatic: QuoteApprovalPolicy[]
  manual: QuoteApprovalPolicy[]
  currentUser: 'automatic' | 'manual' | 'denied' | 'unknown'
}

// ----------------------------------------------------------------- status

export interface Status {
  id: string
  uri: string
  createdAt: string
  editedAt: string | null
  account: Account
  content: string
  visibility: StatusVisibility
  sensitive: boolean
  spoilerText: string
  mediaAttachments: MediaAttachment[]
  /** Only when the author shares it, or the reader is the author. */
  application?: Application | null
  mentions: StatusMention[]
  tags: Tag[]
  emojis: CustomEmoji[]
  reblogsCount: number
  favouritesCount: number
  filtered?: FilterResult[]
  repliesCount: number
  quote?: Quote | ShallowQuote | null
  quotesCount: number
  /** Mastodon 4.5 and later only. */
  quoteApproval?: QuoteApproval | null
  url?: string | null
  inReplyToId?: string | null
  inReplyToAccountId?: string | null
  reblog?: Status | null
  poll?: Poll | null
  card?: PreviewCard | null
  language?: string | null
  /** The source text. Only set on the answer to a delete. */
  text?: string | null
  favourited?: boolean | null
  reblogged?: boolean | null
  muted?: boolean | null
  bookmarked?: boolean | null
  pinned?: boolean | null
  /** Only on a Bluesky post. A Mastodon status never has it. */
  bluesky?: StatusBluesky
}

/** One earlier version of an edited post. */
export type StatusEdit = Pick<
  Status,
  'content' | 'spoilerText' | 'sensitive' | 'createdAt' | 'account' | 'mediaAttachments' | 'emojis' | 'quote'
>

/** A post's text and content warning, as the author wrote them. */
export interface StatusSource {
  id: string
  text: string
  spoilerText: string
}

// ------------------------------------------------------- bluesky fields
//
// The shapes a Bluesky client fills in. Nothing reads them yet; they are
// here so later work has one place to grow them (spec 6.5 and 7.4).

/** An AT URI and the CID of the exact record version. */
export interface BlueskyStrongRef {
  uri: string
  cid: string
}

/** A raw label, as the AppView returns it. */
export interface BlueskyLabel {
  /** The DID of the labeler, or of the author for a self-label. */
  src: string
  uri: string
  cid?: string
  val: string
  neg?: boolean
  cts: string
}

export type BlueskyModerationContext =
  | 'contentList' | 'contentView' | 'contentMedia'
  | 'avatar' | 'banner' | 'profileList' | 'profileView'

/** The SDK's moderation decision, flattened to plain data so it survives JSON. */
export interface BlueskyModerationResult {
  contexts: Record<BlueskyModerationContext, {
    filter: boolean
    blur: boolean
    alert: boolean
    inform: boolean
    noOverride: boolean
    reasons: { label: string; source: string; name: string }[]
  }>
  /** The labelers whose labels this post's data includes. */
  labelersCovered: string[]
}

export interface StatusBluesky {
  /** The post's AT URI. */
  uri: string
  cid: string
  /** The reader's like record, so an unlike can delete it. */
  likeUri: string | null
  /** The reader's repost record, so an un-repost can delete it. */
  repostUri: string | null
  replyRef: { root: BlueskyStrongRef; parent: BlueskyStrongRef } | null
  replyDisabled: boolean
  embeddingDisabled: boolean
  labels: BlueskyLabel[]
  moderation: BlueskyModerationResult
  /** The UserKey whose viewer state this copy carries, or null for a public copy. */
  viewerOf: `${string}@${string}` | null
}

// ---------------------------------------------------------- relationship

export interface Relationship {
  id: string
  following: boolean
  showingReblogs: boolean
  notifying: boolean
  languages?: string[] | null
  followedBy: boolean
  blocking: boolean
  blockedBy: boolean
  muting: boolean
  mutingNotifications: boolean
  requested: boolean
  domainBlocking: boolean
  endorsed: boolean
  note?: string | null
  requestedBy: boolean
  /** Only for a Bluesky account. A Mastodon relationship never has it. */
  bluesky?: RelationshipBluesky
}

export interface RelationshipBluesky {
  /** The reader's follow record, so an unfollow can delete it. */
  followUri: string | null
  /** The reader's block record, so an unblock can delete it. */
  blockUri: string | null
}

// ------------------------------------------------------------ write refs
//
// A write names its target by a ref, not a bare id. Mastodon needs only the
// id. A Bluesky like needs the post's URI and CID, and an undo needs the
// record the earlier write made (spec 6.3, seam 2).

/** What a status action needs to name the post. */
export interface StatusRef {
  id: string
  /** Only for a Bluesky post. A Mastodon ref never has it. */
  bluesky?: Pick<StatusBluesky, 'uri' | 'cid' | 'likeUri' | 'repostUri'>
}

/** What a follow, mute or block needs to name the account. */
export interface AccountRef {
  id: string
  /** Only for a Bluesky account: the records an undo deletes. */
  bluesky?: RelationshipBluesky
}

// ------------------------------------------------------------------ lists

export type ListRepliesPolicy = 'followed' | 'list' | 'none'

export interface List {
  id: string
  title: string
  repliesPolicy: ListRepliesPolicy
  exclusive: boolean
}

// ---------------------------------------------------------- notifications

export interface Report {
  id: string
  actionTaken: boolean
  actionTakenAt?: string | null
  category: 'spam' | 'violation' | 'legal' | 'other'
  comment: string
  forwarded: boolean
  createdAt: string
  statusIds?: string[] | null
  ruleIds?: string[] | null
  targetAccount: Account
}

export interface AccountWarning {
  id: string
  action:
    | 'none' | 'disable' | 'mark_statuses_as_sensitive' | 'delete_statuses'
    | 'sensitive' | 'silence' | 'suspend'
  text: string
  statusIds: string[]
  targetAccount: Account
  appeal?: { text: string; state: 'approved' | 'rejected' | 'pending' } | null
  createdAt: string
}

export interface RelationshipSeveranceEvent {
  id: string
  type: 'domain_block' | 'user_domain_block' | 'account_suspension'
  purged: boolean
  followersCount: number
  followingCount: number
  targetName: string
  createdAt: string
}

interface BaseNotification<T extends string> {
  id: string
  type: T
  createdAt: string
  account: Account
  groupKey: string
}

type PlainNotification<T extends string> = BaseNotification<T> & {
  status?: undefined | null
  report?: undefined | null
}

type StatusNotification<T extends string> = BaseNotification<T> & {
  status: Status
  report?: undefined | null
}

/**
 * One notification. `type` tells which other fields it has: the status
 * types carry `status`, `admin.report` carries `report`.
 */
export type Notification =
  | StatusNotification<'mention' | 'status' | 'reblog' | 'quote' | 'quoted_update' | 'favourite' | 'poll' | 'update'>
  | PlainNotification<'follow' | 'follow_request' | 'admin.sign_up'>
  | (BaseNotification<'admin.report'> & { status?: undefined | null; report: Report })
  | (PlainNotification<'severed_relationships'> & { event: RelationshipSeveranceEvent })
  | (PlainNotification<'moderation_warning'> & { moderationWarning: AccountWarning })

export type NotificationType = Notification['type']

// ----------------------------------------------------------------- search

export interface Search {
  accounts: Account[]
  statuses: Status[]
  hashtags: Tag[]
}

// --------------------------------------------------------------- instance

/**
 * The parts of a server's description that Caribou reads: its limits for
 * compose. Mastodon's `GET /api/v2/instance` has many more fields.
 */
export interface Instance {
  configuration: {
    statuses: {
      maxCharacters: number
      maxMediaAttachments: number
    }
    mediaAttachments: {
      supportedMimeTypes: string[]
    }
    polls: {
      maxOptions: number
      maxCharactersPerOption: number
      minExpiration: number
      maxExpiration: number
    }
  }
}

// ----------------------------------------------------------- capabilities

export type Network = 'mastodon' | 'bluesky'

/**
 * What a network can do. Each client has one (`CaribouClient.capabilities`).
 * A control for a feature the network lacks is hidden, never shown broken.
 * It describes the network, not one post: a post's own limits (Bluesky's
 * `replyDisabled`) are on the post.
 */
export interface Capabilities {
  network: Network
  localTimeline: boolean
  publicTimeline: boolean
  /** Who may see a post: public, unlisted, followers only, direct. */
  visibility: boolean
  /** A content warning with its own text. */
  contentWarningText: boolean
  polls: boolean
  /** Edit a post after it is sent, and see its history. */
  edit: boolean
  customEmoji: boolean
  followTags: boolean
  privateLists: boolean
  serverFilters: boolean
  /** Graphemes per post. Mastodon's server can say a different number. */
  maxChars: number
  /** UTF-8 bytes per post, or null for no byte limit. */
  maxBytes: number | null
  maxImages: number
  /** Bytes per image, or null when the server does not say. */
  maxImageBytes: number | null
}
