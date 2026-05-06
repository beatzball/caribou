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

## elena-app

### Rails should stay pinned during window scroll

Left nav rail and right rail currently scroll with the page. Pin both to
the viewport so they remain visible while the timeline scrolls; this
matches Twitter / mainline Mastodon-web layouts and keeps navigation +
context reachable.

Pair with the next item — the right rail's anchor edge changes too.

Surfaced during Plan 3 local QA, 2026-05-06.

### Right rail anchored to viewport bottom

Today the right rail is top-aligned. Anchor it to the bottom of the
viewport instead — content there (search, suggestions, footer links)
reads as a secondary surface and feels grounded when the rail is short.

Verify behavior when the rail is taller than the viewport: should
overflow upward (so the bottom-most item stays visible) rather than
clipping.

Surfaced during Plan 3 local QA, 2026-05-06.

### Truncate long links with full URL on hover

Long URLs in status content overflow card width. Truncate to N visible
characters (with ellipsis) and put the full URL in `title` (and
`aria-label` for SR users) so hover reveals it. The sanitizer already
runs on the server — apply the truncation there so SSR + hydration
agree byte-for-byte (otherwise we re-introduce the parity drift Plan 3
just closed).

Surfaced during Plan 3 local QA, 2026-05-06.

### Warmer color theme + cream light mode

Current palette skews blue/purple. Shift toward deep orange / brown
warm tones for dark mode, and add a warm-light variant with
cream / off-white background. Goal is a "classic" feel in either mode.

Lives in `packages/design-tokens` — extend the token set rather than
overriding per-component. Verify the contrast story still meets WCAG
AA for both modes.

Surfaced during Plan 3 local QA, 2026-05-06.

### SPA-nav jitter / suspected FOUC on internal link clicks

Clicking Home / Local / About etc. produces visible jitter — likely a
flash of unstyled content during the client-side route transition.
Investigate whether (a) declarative-shadow-DOM adoption is being
re-run on hydration, (b) UnoCSS classes are missing on the inbound
chunk, or (c) the new page is rendering before tokens-head /
uno-head are applied.

Repro: load `/home`, click `Local`, watch for layout shift before
content settles.

Surfaced during Plan 3 local QA, 2026-05-06.

### Stale avatars when timeline polling appends new posts

When the timeline polls and prepends new statuses, avatar images for
the *existing* (older) cards re-render with the *previous* poll's
account images — i.e. the prepended statuses display correctly but
the older rows visually swap to the wrong avatars for one frame
(or persist).

Likely a Lit `repeat` keying issue or a `caribou-status-card` prop
identity collision: rows are keyed by index rather than status id, so
prepending shifts every account binding by one. Fix by keying on
`status.id` and ensuring `<caribou-status-card>` resets avatar src on
status-id change rather than on a stale internal cache.

Surfaced during Plan 3 local QA, 2026-05-06.
