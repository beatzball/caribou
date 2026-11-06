import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  Account, MediaAttachment, Poll, PollOption, PreviewCard, Relationship, Status, StatusBluesky,
} from '../types.js'

// The owned types took corrections in #204: fields Mastodon sends as null,
// fields it leaves out, and a viewer key that must be a UserKey. These
// checks run in `tsc` (the package's typecheck), so a type that goes back
// to its old shape fails the build, not only a reader's eye.

/** True when `K` may be left out of `T`. */
type IsOptional<T, K extends keyof T> = Record<string, never> extends Pick<T, K> ? true : false

describe('owned types contract', () => {
  it('accepts null where Mastodon sends null', () => {
    expectTypeOf<null>().toMatchTypeOf<Account['lastStatusAt']>()
    expectTypeOf<null>().toMatchTypeOf<MediaAttachment['previewUrl']>()
    expectTypeOf<null>().toMatchTypeOf<PollOption['votesCount']>()
    expectTypeOf<null>().toMatchTypeOf<PreviewCard['blurhash']>()
    expectTypeOf<null>().toMatchTypeOf<Relationship['languages']>()
  })

  it('lets a status leave out application and quoteApproval', () => {
    expectTypeOf<IsOptional<Status, 'application'>>().toEqualTypeOf<true>()
    expectTypeOf<IsOptional<Status, 'quoteApproval'>>().toEqualTypeOf<true>()
    // The check itself tells a required field from an optional one.
    expectTypeOf<IsOptional<Status, 'id'>>().toEqualTypeOf<false>()
  })

  it('takes a UserKey for viewerOf, and not a bare DID', () => {
    const owner: StatusBluesky['viewerOf'] = 'did:plc:alice@bsky'
    const publicCopy: StatusBluesky['viewerOf'] = null
    // @ts-expect-error A DID alone does not say which account's view it is.
    const bare: StatusBluesky['viewerOf'] = 'did:plc:alice'
    expect([owner, publicCopy, bare]).toHaveLength(3)
  })

  it('types a poll with its emoji on the poll, none on the options, without a cast', () => {
    const poll: Poll = {
      id: 'p1', expired: false, multiple: false, votesCount: 4, votersCount: 4,
      options: [{ title: 'Tea :tea:', votesCount: 3 }, { title: 'Coffee', votesCount: null }],
      emojis: [{ shortcode: 'tea', url: 'https://example.social/tea.png', staticUrl: 'https://example.social/tea.png', visibleInPicker: true }],
    }
    expect(poll.emojis[0]!.shortcode).toBe('tea')
    expect(poll.options.every((o) => !('emojis' in o))).toBe(true)
  })
})
