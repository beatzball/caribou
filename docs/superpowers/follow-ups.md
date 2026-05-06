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

### Full-reload FOUC on internal link clicks

Clicking Home / Local / About etc. produces visible jitter — a flash
of unstyled content as the new page paints. Caribou's nav rail and
all internal anchors are plain `<a>` tags, so each click is a full
browser navigation; `litro-router` is installed but only intercepts
`<litro-link>`, which we don't use yet. Investigate whether (a)
declarative-shadow-DOM adoption is being re-run on hydration,
(b) UnoCSS classes are missing on the inbound chunk, or (c) the
new page is rendering before tokens-head / uno-head are applied.

Repro: load `/home`, click `Local`, watch for layout shift before
content settles.

A separate decision (deferred): swap nav-rail anchors and the
status-card permalink to `<litro-link>` for SPA navigation. Keeps
the app shell mounted, eliminates the full-reload FOUC by
construction, but requires coordinated change across every internal
link and care that route transitions don't tear down stores that
were warm.

Surfaced during Plan 3 local QA, 2026-05-06.

### Click-anywhere-on-card → thread (Elk-style delegation)

Status cards currently expose the thread permalink only on the
timestamp anchor (the no-JS-safe primitive). Most social UIs let you
click anywhere on the card body to open the thread. Elk's pattern:
a `<div tabindex="0" @click @keydown.enter>` wrapper that walks
`event.target.closest('a, button, img, video')`, bails if the click
landed on an interactive child, also bails if `window.getSelection()`
is non-empty (don't hijack text selection), and otherwise calls
`router.push(statusRoute)`. Cmd/Ctrl-click → `window.open` for
new-tab.

Deferred to Plan 4 because the target-walking logic wants to know
about boost / favourite / reply buttons that don't exist until
interactions ship; adding it earlier means rewriting the predicate.
The timestamp anchor remains the no-JS fallback either way.

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
