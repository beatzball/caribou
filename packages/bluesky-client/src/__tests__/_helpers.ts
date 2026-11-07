import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BlueskyModerationContext, BlueskyModerationResult } from '@beatzball/caribou-mastodon-client'
import type { MapContext } from '../map/context.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '__fixtures__')

/** A fresh copy of a fixture, so a test can change it. */
export function fixture<T = never>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T
}

const CONTEXTS: BlueskyModerationContext[] = ['contentList', 'contentView', 'contentMedia', 'avatar', 'banner', 'profileList', 'profileView']

/** A moderation result that names its subject, so a test can see which view it came from. */
export function moderationFor(subject: string): BlueskyModerationResult {
  const ui = { filter: false, blur: false, alert: false, inform: false, noOverride: false, reasons: [{ label: 'test', source: subject, name: subject }] }
  return { contexts: Object.fromEntries(CONTEXTS.map((c) => [c, ui])) as BlueskyModerationResult['contexts'], labelersCovered: [] }
}

export const READER = 'did:plc:reader@bsky' as const

export const ctx: MapContext = { viewerOf: READER, moderatePost: (view) => moderationFor(view.uri) }
