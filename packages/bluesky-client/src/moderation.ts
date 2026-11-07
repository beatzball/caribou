import {
  BSKY_LABELER_DID, CUSTOM_LABEL_VALUE_RE, DEFAULT_LABEL_SETTINGS, LABELS,
  interpretLabelValueDefinitions, moderatePost, moderateProfile,
} from '@atproto/api'
import type {
  AppBskyActorDefs, AppBskyFeedDefs, AppBskyLabelerDefs, ComAtprotoLabelDefs,
  InterpretedLabelValueDefinition, LabelPreference, ModerationCause, ModerationDecision, ModerationPrefs,
} from '@atproto/api'
import type {
  BlueskyModerationContext, BlueskyModerationReason, BlueskyModerationResult, BlueskyModerationUi, StatusBluesky,
} from '@beatzball/caribou-mastodon-client'

// The rules this file follows are in the package README, "Moderation rules".
// Every gap fails closed: when Caribou does not know, it covers.

/** Which SDK function to run: a post (`moderatePost`) or a profile (`moderateProfile`). */
export type ModerationSubject =
  | { kind: 'post'; view: AppBskyFeedDefs.PostView }
  | { kind: 'profile'; view: AppBskyActorDefs.ProfileViewBasic | AppBskyActorDefs.ProfileView | AppBskyActorDefs.ProfileViewDetailed }

/** Label definitions per labeler DID, as `moderatePost` takes them. */
export type LabelDefs = Record<string, InterpretedLabelValueDefinition[]>

export interface ModerateOptions {
  /**
   * The labelers the AppView applied to the fetch that gave this view (its
   * `atproto-content-labelers` answer). Unknown is `[]`, which never settles
   * the reader veil for a reader with labelers.
   */
  labelersCovered?: string[]
}

/** The reason name of a label Caribou could not define because its labeler's definitions did not load. */
export const LABELER_UNAVAILABLE = 'Content warning (labeler unavailable)'
/** The reason name of a label its labeler's loaded definitions do not name. */
export const UNKNOWN_LABEL = 'Content warning (unknown label)'

/** True for a fail-closed reason. The cover then offers Retry, not Show. */
export function isLabelerUnavailable(reason: BlueskyModerationReason): boolean {
  return reason.name === LABELER_UNAVAILABLE || reason.name === UNKNOWN_LABEL
}

/** What the server uses: it does not know the reader (spec 7.4). */
export const LOGGED_OUT_PREFS: ModerationPrefs = Object.freeze({
  adultContentEnabled: false,
  labels: { ...DEFAULT_LABEL_SETTINGS },
  labelers: [{ did: BSKY_LABELER_DID, labels: {} }],
  mutedWords: [],
  hiddenPosts: [],
})

const CONTEXTS: BlueskyModerationContext[] = [
  'contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView',
]

type Target = 'content' | 'account' | 'profile'

// What a label could hide, per target, when Caribou cannot define it. An
// account label is the widest: it reaches the account's posts too.
const GAP_CONTEXTS: Record<Target, BlueskyModerationContext[]> = {
  content: ['contentList', 'contentView', 'contentMedia'],
  account: CONTEXTS,
  profile: ['avatar', 'banner'],
}

// English names for the SDK's built-in labels; they carry no locales.
const BUILT_IN_NAMES: Record<string, string> = {
  '!hide': 'Hidden by moderators',
  '!warn': 'Content warning',
  '!no-unauthenticated': 'Signed-in readers only',
  porn: 'Adult content',
  sexual: 'Sexually suggestive',
  nudity: 'Non-sexual nudity',
  'graphic-media': 'Graphic media',
  gore: 'Graphic media',
}

const CAUSE_NAMES: Record<Exclude<ModerationCause['type'], 'label'>, string> = {
  blocking: 'You blocked this account',
  'blocked-by': 'This account blocked you',
  'block-other': 'Blocked',
  muted: 'You muted this account',
  'mute-word': 'Hidden by a muted word',
  hidden: 'You hid this post',
}

const PROFILE_SELF = '/app.bsky.actor.profile/self'

interface TargetedLabel { label: ComAtprotoLabelDefs.Label; target: Target; owner: string }

// The labels the SDK reads for this subject, with the same targets: the
// post's own (content), and its author's split as `decideAccount` and
// `decideProfile` split them. A quoted post is moderated on its own.
function labelsOf(subject: ModerationSubject): TargetedLabel[] {
  const actor = subject.kind === 'post' ? subject.view.author : subject.view
  const out: TargetedLabel[] = []
  if (subject.kind === 'post') {
    for (const label of subject.view.labels ?? []) out.push({ label, target: 'content', owner: actor.did })
  }
  for (const label of actor.labels ?? []) {
    const onProfile = label.uri.endsWith(PROFILE_SELF)
    if (!onProfile || label.val === '!no-unauthenticated') out.push({ label, target: 'account', owner: actor.did })
    if (onProfile) out.push({ label, target: 'profile', owner: actor.did })
  }
  return out
}

// Prefs missing: hide all a label could hide. Adult content off, every
// built-in and every value on the subject set to hide, and every labeler
// named on the subject counted as subscribed.
function strictPrefs(labels: TargetedLabel[]): ModerationPrefs {
  const hide: Record<string, LabelPreference> = {}
  for (const val of Object.keys(LABELS)) hide[val] = 'hide'
  for (const { label } of labels) hide[label.val] = 'hide'
  const labelers = [...new Set(labels.map((l) => l.label.src).filter((src, i) => src !== labels[i]!.owner))]
  return { adultContentEnabled: false, labels: hide, labelers: labelers.map((did) => ({ did, labels: {} })), mutedWords: [], hiddenPosts: [] }
}

// Would the SDK find a definition for this label? (`ModerationDecision.addLabel`.)
function sdkDefines(label: ComAtprotoLabelDefs.Label, labelDefs: LabelDefs | null): boolean {
  if (CUSTOM_LABEL_VALUE_RE.test(label.val) && labelDefs?.[label.src]?.some((d) => d.identifier === label.val)) return true
  return label.val in LABELS
}

function defName(label: ComAtprotoLabelDefs.Label, def: InterpretedLabelValueDefinition | undefined): string {
  const locales = def?.locales ?? []
  const en = locales.find((l) => l.lang === 'en' || l.lang.startsWith('en-')) ?? locales[0]
  return en?.name || BUILT_IN_NAMES[label.val] || label.val
}

function reasonOf(cause: ModerationCause): BlueskyModerationReason {
  if (cause.type === 'label') {
    return { label: cause.label.val, source: cause.label.src, name: defName(cause.label, cause.labelDef) }
  }
  const source = cause.source.type === 'list' ? cause.source.list.uri : cause.source.type === 'labeler' ? cause.source.did : ''
  return { label: cause.type, source, name: CAUSE_NAMES[cause.type] }
}

function pushReason(ui: BlueskyModerationUi, reason: BlueskyModerationReason) {
  if (!ui.reasons.some((r) => r.label === reason.label && r.source === reason.source)) ui.reasons.push(reason)
}

function flatten(decision: ModerationDecision, context: BlueskyModerationContext): BlueskyModerationUi {
  const sdk = decision.ui(context)
  const ui: BlueskyModerationUi = {
    filter: sdk.filter, blur: sdk.blur, alert: sdk.alert, inform: sdk.inform,
    noOverride: sdk.noOverride, reasons: [],
  }
  for (const cause of [...sdk.blurs, ...sdk.filters, ...sdk.alerts, ...sdk.informs]) pushReason(ui, reasonOf(cause))
  return ui
}

/**
 * Runs the SDK's moderation and flattens the decision to plain data, one
 * entry per context (spec 7.4). The SDK's class instance never leaves this
 * function. Not server-safe for the browser: it imports `@atproto/api`, so
 * the client loads it only through a dynamic `import()` (the `bsky` chunk).
 *
 * `prefs` or `labelDefs` `null` means they are missing or failed to load;
 * moderation then fails closed (README, "Moderation rules").
 */
export function moderate(
  subject: ModerationSubject,
  userDid: string | undefined,
  prefs: ModerationPrefs | null,
  labelDefs: LabelDefs | null,
  opts: ModerateOptions = {},
): BlueskyModerationResult {
  const labels = labelsOf(subject).filter((l) => !l.label.neg)
  const effective = prefs ?? strictPrefs(labels)
  const sdkOpts = { userDid, prefs: effective, labelDefs: labelDefs ?? {} }
  const decision = subject.kind === 'post' ? moderatePost(subject.view, sdkOpts) : moderateProfile(subject.view, sdkOpts)

  const contexts = Object.fromEntries(CONTEXTS.map((c) => [c, flatten(decision, c)])) as BlueskyModerationResult['contexts']

  // Fail closed: a label from a subscribed labeler that the SDK would skip
  // for want of a definition covers what it could cover, with no Show.
  const subscribed = new Set(effective.labelers.map((l) => l.did))
  for (const { label, target, owner } of labels) {
    if (label.src === owner) continue // a self-label: the SDK knows every value it may use
    if (!subscribed.has(label.src)) continue
    if (sdkDefines(label, labelDefs)) continue
    const name = labelDefs?.[label.src] ? UNKNOWN_LABEL : LABELER_UNAVAILABLE
    const isMe = owner === userDid
    for (const c of GAP_CONTEXTS[target]) {
      const ui = contexts[c]
      ui.blur = true
      if (!isMe) ui.noOverride = true
      pushReason(ui, { label: label.val, source: label.src, name })
    }
  }

  return { contexts, labelersCovered: [...(opts.labelersCovered ?? [])] }
}

/** `getServices?dids=…&detailed=true` → definitions keyed by labeler DID. */
export function labelDefsFromServices(views: AppBskyLabelerDefs.LabelerViewDetailed[]): LabelDefs {
  const out: LabelDefs = {}
  for (const view of views) out[view.creator.did] = interpretLabelValueDefinitions(view)
  return out
}

/**
 * True when the author asked that signed-out readers not see them (spec
 * 8.3). The server checks it per post and renders a notice instead.
 */
export function isNoUnauthenticated(actor: { labels?: ComAtprotoLabelDefs.Label[] }): boolean {
  return (actor.labels ?? []).some((l) => l.val === '!no-unauthenticated' && !l.neg)
}

/** The active Bluesky reader, as the veil needs it. `null` fields are "not loaded". */
export interface BlueskyReader {
  userKey: NonNullable<StatusBluesky['viewerOf']>
  prefs: ModerationPrefs | null
  labelDefs: LabelDefs | null
}

/**
 * The reader veil's check for one Bluesky card (spec 7.4). `reader` is null
 * when no Bluesky account is active: the logged-out default is final then.
 */
export function blueskyCheckSettled(
  post: Pick<StatusBluesky, 'viewerOf' | 'moderation'>,
  reader: BlueskyReader | null,
): boolean {
  if (!reader) return true
  const { prefs, labelDefs } = reader
  if (!prefs || !labelDefs) return false
  const subscribed = prefs.labelers.map((l) => l.did)
  // Bluesky's own labeler publishes only built-in labels; others need definitions.
  if (subscribed.some((did) => did !== BSKY_LABELER_DID && !labelDefs[did])) return false
  if (post.viewerOf !== reader.userKey) return false
  const covered = new Set(post.moderation.labelersCovered)
  return subscribed.every((did) => covered.has(did))
}
