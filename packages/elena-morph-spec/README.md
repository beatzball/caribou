# @beatzball/elena-morph-spec

> Behavioral spec for `@elenajs/core`'s morph engine vs. custom-element children.

**Status:** Designed for upstream — written to lift directly into Elena's repo.

## Purpose

When an Elena component re-renders, `morphContent` walks the old DOM
in parallel with the freshly-rendered template fragment. It uses
`parent.childNodes`, which is the standard light-DOM accessor — it
never crosses a shadow root boundary. That platform fact has a sharp
consequence: a custom element rendered in *light* DOM has its content
treated as the *parent's* responsibility by morph. If the parent's
template has `<my-card></my-card>` (empty), morph wipes whatever
`<my-card>` rendered into itself, and the wipe sticks until something
else re-renders the child.

This package is the spec that pins the workaround: render into shadow
DOM by default. The single test file exercises four scenarios — shadow
DOM (recommended pattern, content survives), slotted content (parent
opts in, morph reconciles correctly), native elements (always works),
and the light-DOM trap (`it.fails` so a future Elena fix flips it
green). It's intentionally written as a self-contained Vitest spec so
an Elena maintainer can drop the file into their own repo and run it
unchanged.

## Position in the stack

- **Depends on:** `@elenajs/core` (runtime); `happy-dom`, `vitest`,
  `typescript` (devDeps — only loaded when running the spec)
- **Depended on by:** nothing — it's a pinned behavioral contract,
  not a runtime dependency
- **Boundary it owns:** documenting the morph-vs-custom-element
  contract in executable form. Once Elena's docs cover this directly,
  the spec ports to Elena's test suite and this package goes away.

## Public API

None. The package exports nothing. It exists to *run* — the test file
is the deliverable. Treat it like a test fixture that ships with the
repo for documentation purposes.

## How it works

**Four sections, three behaviors plus one gotcha.**

1. Shadow DOM children (recommended): host's render lives in
   `host.shadowRoot`, invisible to `parent.childNodes`. Parent
   template's empty `<my-card></my-card>` is consistent with reality.
   Re-renders are no-ops on the child's content. ✅
2. Slotted children: parent's template has children inside the
   custom-element tag, opting into reconciliation. Morph recurses;
   children update. ✅
3. Native elements: always recursed by morph. ✅
4. Light-DOM children (anti-pattern): host renders into its own
   `childNodes`, parent's template doesn't reflect those children,
   morph wipes them. Marked `it.fails` so the day Elena fixes this,
   the test flips green and the suite fails loudly. 🚫 → 🎯

**`flush()` is three resolved promises.** Elena's `_safeRender` queues
via `queueMicrotask`. Three awaited resolved promises catch the
scheduling tick *plus* any follow-up work the `updated()` callback
queues (e.g. cascading child renders). Two would be enough for the
simple cases; three is the safe default.

## Gotchas

- **The spec is normative, not advisory.** Section 1 isn't documenting
  a recommendation — it's documenting the only safe pattern given
  morph's current behavior. Code reviews on Elena components should
  treat shadow-DOM rendering as the default and require justification
  for opting out.
- **`it.fails` will flip when Elena fixes the bug.** That's intentional.
  When it flips, port the spec into Elena and delete this package.
  Don't update the assertion to match the new behavior — the failure
  is the signal.
- **happy-dom's morph behavior matches the browser, but not perfectly.**
  Edge cases around adopted stylesheets and declarative shadow DOM
  occasionally diverge. The spec sticks to behaviors that are
  consistent across happy-dom and real browsers.

## Externalization potential

**Designed for upstream.** The whole point of this package is that the
file is portable to Elena's own repo without modification — same
Vitest + happy-dom setup, same `@elenajs/core` import, no Caribou
identifiers. The day Elena either fixes the morph behavior or
documents the shadow-DOM-default pattern in their own test suite,
this package retires. The migration from "Caribou hosts the spec" to
"Elena hosts the spec" is a single `git mv`.

## Alternatives considered: where to host the spec

| Approach | What we'd gain | What we'd give up |
|---|---|---|
| Separate package in Caribou (chosen) | Self-contained, runs in our CI, easy to update if morph behavior shifts under us | Lives outside Elena until upstream picks it up |
| Inline in a Caribou component test | One fewer package | Implicit dependency on `@elenajs/core` private behavior buried in app tests; harder to lift |
| Patch upstream and submit a PR | Documents the contract where it belongs | Elena's release cadence; we'd have to wait for a maintainer to merge before we benefit |
| Write it as a docs page only | Cheap | Not executable; goes stale |

The current shape (executable spec in a dedicated package) is the
cheapest version that keeps the contract testable on every Caribou
build *and* port-ready when Elena is ready to absorb it.

## See also

- `apps/caribou-elena/pages/components/*` — components follow the
  shadow-DOM pattern this spec validates
- `docs/superpowers/specs/2026-04-21-caribou-v1-design.md` §11 —
  references the morph-vs-shadow-DOM finding from the original
  investigation
