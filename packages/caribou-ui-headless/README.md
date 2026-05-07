# @beatzball/caribou-ui-headless

> Framework-agnostic browser primitives that any custom-element library can consume.

**Status:** Ready as-is — already published-shape; no Caribou-specific imports.

## Purpose

A holding pen for tiny utilities that have no business being tied to a
component framework. Right now: a thin wrapper around `IntersectionObserver`
with a test-friendly seam, and a compact relative-time formatter for
status timestamps. Things that satisfy "would work in any browser, any
framework, no auth, no domain types" land here.

## Position in the stack

- **Depends on:** nothing — DOM globals only
- **Depended on by:** `apps/caribou-elena/pages/components/*` (the
  status-card uses `formatRelativeTime`; the timeline uses
  `createIntersectionObserver` for infinite-scroll triggers)
- **Boundary it owns:** code that's small, generic, and would otherwise
  end up duplicated across components

## Public API

- `createIntersectionObserver(callback, options?)` — returns a
  `CaribouIntersectionObserver` (`observe(el)`, `disconnect()`).
  The wrapper exists so tests have one seam to swap.
- `formatRelativeTime(iso, now?)` — `'just now' | '{m}m' | '{h}h' | '{d}d' | 'Mon DD' | 'Mon DD, YYYY'`.
  Six ranges with a 7-day cutoff before switching to dates.

## How it works

Nothing clever. The intersection observer wrapper is a one-line
forwarder; the relative-time formatter is a five-branch `if` ladder
(see source comment for the ranges). Both are deliberately unsurprising
so callers can reason about behavior without reading the implementation.

The relative-time formatter clamps negative deltas to 0 (so a future
timestamp from clock skew renders as "just now" instead of `-5m`), and
the year-comparison uses UTC to keep cross-timezone behavior stable.

## Gotchas

- **`createIntersectionObserver` does not polyfill.** Caller is
  responsible for ensuring `IntersectionObserver` exists. All evergreen
  browsers ship it; the wrapper is just a test seam.
- **`formatRelativeTime` does not validate its input.** A malformed ISO
  string makes `new Date(iso).getTime()` return `NaN`, which falls
  through every comparison and produces output like `"NaN m"` or
  `"undefined NaN"`. Validate at the call site if the input could be
  user-supplied; status timestamps from masto are always well-formed,
  which is why the function trusts them.
- **`formatRelativeTime` returns plain strings, not units.** No locale
  handling, no `Intl.RelativeTimeFormat`. If we ever localize Caribou,
  this function gets replaced wholesale rather than parameterized — the
  format itself ("3h", "Apr 14") is a Mastodon-client convention, not
  a flag-driven choice.

## Externalization potential

**Ready as-is.** No workspace deps, no Caribou-specific identifiers, no
domain types. The `caribou-` prefix in the package name is the only
thing that would change. Publishing pre-supposes a stable enough API
that a v1 commitment makes sense — currently both functions feel
stable, but the pool is too small to be worth a separate package's
release overhead.

## See also

- `packages/state/src/polling.ts` — sibling helper, lives in `state`
  because it's coupled to visibility-aware fetch loops
