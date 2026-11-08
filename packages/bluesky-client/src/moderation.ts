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
/** The reason name of a label nobody's loaded definitions name. */
export const UNKNOWN_LABEL = 'Content warning (unknown label)'
/** The reason name of the cover when the SDK threw. */
export const MODERATION_FAILED = 'Content warning (moderation failed)'

/** True for a fail-closed reason. The cover then offers Retry, not Show. */
export function isLabelerUnavailable(reason: BlueskyModerationReason): boolean {
  return reason.name === LABELER_UNAVAILABLE || reason.name === UNKNOWN_LABEL || reason.name === MODERATION_FAILED
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

// Label definitions with no prototype, so a labeler DID such as
// `constructor` finds nothing. Only own entries that are arrays are kept.
function ownDefs(labelDefs: LabelDefs | null): LabelDefs {
  const out = Object.create(null) as LabelDefs
  for (const [did, defs] of Object.entries(labelDefs ?? {})) if (Array.isArray(defs)) out[did] = defs
  return out
}

// Would the SDK find a definition for this label (`ModerationDecision.addLabel`),
// by own keys only? A value that names an `Object.prototype` member never
// counts: the SDK would read the prototype and throw.
function sdkDefines(label: ComAtprotoLabelDefs.Label, defs: LabelDefs): boolean {
  const val = label.val
  if (typeof val !== 'string' || val in Object.prototype) return false
  if (CUSTOM_LABEL_VALUE_RE.test(val) && Object.hasOwn(defs, label.src) && defs[label.src]!.some((d) => d.identifier === val)) return true
  return Object.hasOwn(LABELS, val)
}

type Labeled = { labels?: ComAtprotoLabelDefs.Label[] }

// Step 1 (README): a copy of the subject with only labels the SDK can
// define, and no negated ones, wherever the SDK reads labels.
function cleanLabels<T extends Labeled>(x: T, defs: LabelDefs): T {
  return Array.isArray(x.labels) ? { ...x, labels: x.labels.filter((l) => !l.neg && sdkDefines(l, defs)) } : x
}

function cleanRecord(record: unknown, defs: LabelDefs): unknown {
  if (!record || typeof record !== 'object') return record
  const r = cleanLabels(record as Labeled & { author?: unknown }, defs)
  return r.author && typeof r.author === 'object' ? { ...r, author: cleanLabels(r.author as Labeled, defs) } : r
}

function cleanEmbed(embed: AppBskyFeedDefs.PostView['embed'], defs: LabelDefs): AppBskyFeedDefs.PostView['embed'] {
  if (!embed || typeof embed !== 'object') return embed
  const e = embed as { $type?: string; record?: { record?: unknown } }
  if (e.$type === 'app.bsky.embed.record#view') return { ...embed, record: cleanRecord(e.record, defs) } as typeof embed
  if (e.$type === 'app.bsky.embed.recordWithMedia#view' && e.record && typeof e.record === 'object') {
    return { ...embed, record: { ...e.record, record: cleanRecord(e.record.record, defs) } } as typeof embed
  }
  return embed
}

function cleanSubject(subject: ModerationSubject, defs: LabelDefs): ModerationSubject {
  if (subject.kind === 'profile') return { kind: 'profile', view: cleanLabels(subject.view, defs) }
  const view = cleanLabels(subject.view, defs)
  return { kind: 'post', view: { ...view, author: cleanLabels(view.author, defs), embed: cleanEmbed(view.embed, defs) } }
}

// Bluesky's labeler is always subscribed (README); `getPreferences` adds it too.
function withBskyLabeler(prefs: ModerationPrefs): ModerationPrefs {
  if (prefs.labelers.some((l) => l.did === BSKY_LABELER_DID)) return prefs
  return { ...prefs, labelers: [{ did: BSKY_LABELER_DID, labels: {} }, ...prefs.labelers] }
}

// Prefs missing: hide all a label could hide. Adult content off, every
// built-in and every value on the subject set to hide, and every labeler
// named on the subject counted as subscribed. Only safe values become keys.
function strictPrefs(labels: TargetedLabel[], defs: LabelDefs): ModerationPrefs {
  const hide: Record<string, LabelPreference> = {}
  for (const val of Object.keys(LABELS)) hide[val] = 'hide'
  for (const { label } of labels) if (sdkDefines(label, defs)) hide[label.val] = 'hide'
  const labelers = [...new Set(labels.filter((l) => l.label.src !== l.owner).map((l) => l.label.src))]
  return { adultContentEnabled: false, labels: hide, labelers: labelers.map((did) => ({ did, labels: {} })), mutedWords: [], hiddenPosts: [] }
}

function defName(label: ComAtprotoLabelDefs.Label, def: InterpretedLabelValueDefinition | undefined): string {
  const locales = Array.isArray(def?.locales) ? def.locales : []
  const en = locales.find((l) => l.lang === 'en' || l.lang.startsWith('en-')) ?? locales[0]
  if (typeof en?.name === 'string' && en.name) return en.name
  return Object.hasOwn(BUILT_IN_NAMES, label.val) ? BUILT_IN_NAMES[label.val]! : String(label.val)
}

function reasonOf(cause: ModerationCause): BlueskyModerationReason {
  if (cause.type === 'label') {
    return { label: String(cause.label.val), source: String(cause.label.src), name: defName(cause.label, cause.labelDef) }
  }
  const source = cause.source.type === 'list' ? cause.source.list.uri : cause.source.type === 'labeler' ? cause.source.did : ''
  return { label: cause.type, source, name: Object.hasOwn(CAUSE_NAMES, cause.type) ? CAUSE_NAMES[cause.type] : cause.type }
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

// Step 2's fallback: the SDK threw, so cover everything.
function failedContexts(): BlueskyModerationResult['contexts'] {
  return Object.fromEntries(CONTEXTS.map((c) => [c, {
    filter: false, blur: true, alert: false, inform: false, noOverride: true,
    reasons: [{ label: '!moderation-failed', source: '', name: MODERATION_FAILED }],
  }])) as BlueskyModerationResult['contexts']
}

/**
 * Runs the SDK's moderation and flattens the decision to plain data, one
 * entry per context (spec 7.4). The SDK's class instance never leaves this
 * function. Not server-safe for the browser: it imports `@atproto/api`, so
 * the client loads it only through a dynamic `import()` (the `bsky` chunk).
 *
 * `prefs` or `labelDefs` `null` means they are missing or failed to load;
 * moderation then fails closed (README, "Moderation rules"). It never throws.
 */
export function moderate(
  subject: ModerationSubject,
  userDid: string | undefined,
  prefs: ModerationPrefs | null,
  labelDefs: LabelDefs | null,
  opts: ModerateOptions = {},
): BlueskyModerationResult {
  const labelersCovered = [...(opts.labelersCovered ?? [])]
  try {
    return { contexts: decide(subject, userDid, prefs, labelDefs), labelersCovered }
  } catch {
    return { contexts: failedContexts(), labelersCovered }
  }
}

function decide(
  subject: ModerationSubject,
  userDid: string | undefined,
  prefs: ModerationPrefs | null,
  labelDefs: LabelDefs | null,
): BlueskyModerationResult['contexts'] {
  const defs = ownDefs(labelDefs)
  const labels = labelsOf(subject).filter((l) => !l.label.neg)
  const effective = withBskyLabeler(prefs ?? strictPrefs(labels, defs))
  const clean = cleanSubject(subject, defs)
  const sdkOpts = { userDid, prefs: effective, labelDefs: defs }
  const decision = clean.kind === 'post' ? moderatePost(clean.view, sdkOpts) : moderateProfile(clean.view, sdkOpts)

  const contexts = Object.fromEntries(CONTEXTS.map((c) => [c, flatten(decision, c)])) as BlueskyModerationResult['contexts']
  const actorDid = subject.kind === 'post' ? subject.view.author.did : subject.view.did
  const readerIsActor = actorDid === userDid

  // Prefs missing: no cover may offer Show, except on the reader's own.
  if (!prefs && !readerIsActor) {
    for (const ui of Object.values(contexts)) if (ui.blur) ui.noOverride = true
  }

  // Step 3, the gap scan: a label the cleaning dropped, from the author or a
  // subscribed labeler, covers what it could cover, with no Show.
  const subscribed = new Set(effective.labelers.map((l) => l.did))
  for (const { label, target, owner } of labels) {
    if (sdkDefines(label, defs)) continue
    const self = label.src === owner
    if (!self && !subscribed.has(label.src)) continue
    const name = self || Object.hasOwn(defs, label.src) ? UNKNOWN_LABEL : LABELER_UNAVAILABLE
    const isMe = owner === userDid
    for (const c of GAP_CONTEXTS[target]) {
      const ui = contexts[c]
      ui.blur = true
      if (!isMe) ui.noOverride = true
      pushReason(ui, { label: String(label.val), source: String(label.src), name })
    }
  }
  return contexts
}

/** `getServices?dids=…&detailed=true` → definitions keyed by labeler DID. */
export function labelDefsFromServices(views: AppBskyLabelerDefs.LabelerViewDetailed[]): LabelDefs {
  const out: LabelDefs = {}
  for (const view of views) out[view.creator.did] = interpretLabelValueDefinitions(view)
  return out
}

// Spec 8.3. One copy, in a server-safe module, so the mappers can call it too.
export { isNoUnauthenticated, isProvenVisible } from './no-unauthenticated.js'
// Signed-out pages (#187): the server's SSR and the browser's fallback.
export * from './signed-out.js'

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
  // Bluesky's labeler is always subscribed, and has custom labels of its own.
  const subscribed = withBskyLabeler(prefs).labelers.map((l) => l.did)
  if (subscribed.some((did) => !Object.hasOwn(labelDefs, did))) return false
  if (post.viewerOf !== reader.userKey) return false
  const covered = new Set(post.moderation.labelersCovered)
  return covered.size > 0 && subscribed.every((did) => covered.has(did))
}
