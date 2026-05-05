# Follow-ups

Items deferred from in-flight work. Not bugs — design decisions worth
revisiting once their context changes.

## state

### profile-store loses the SSR cursor anchor that timeline-store has

`packages/state/src/timeline-store.ts` carries `opts.initial.nextMaxId`
through to the first `loadMore` call (`nextMaxIdForFirstLoadMore`).
`profile-store.ts` does not — its `loadMore` always uses
`statusIds.value[statusIds.value.length - 1]` as the cursor.

Currently safe because Mastodon paginates account statuses with `max_id`
and the SSR fetcher's last status id matches the cursor for the next
page. Will silently skip a page if the fetcher ever switches to a
non-id cursor (e.g. opaque next-page tokens, or filtering that excludes
the boundary status).

**Resolution:** mirror the timeline-store pattern in profile-store
(`nextMaxIdForFirstLoadMore` + drop on first use) when adding any
non-trivial filtering or cursor change.

Surfaced during state README pilot, 2026-05-05.
