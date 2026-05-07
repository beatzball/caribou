---
'caribou-elena': patch
---

Quote interpolated attribute slots in Elena templates.

Elena's compiler recognizes attribute slots only when the preceding static fragment ends with `name="` or `name='`. An unquoted slot (`data-variant=${value}`) compiles to a comment-node placeholder, and the HTML parser swallows that comment marker into the surrounding unquoted attribute value — pulling neighboring attributes into the value as text and producing nonsense attribute names on the element (e.g. `data-variant="style=\"padding:1px"`, `solid=""`, `var(--border);"`).

The first render uses `replaceChildren()` and tolerates the malformed tree. Subsequent renders go through Elena's morph, which iterates `el.attributes` and calls `setAttribute(name, value)` for each — and throws `InvalidCharacterError: String contains an invalid character` on the first attribute whose name has a `"` or other illegal char. The card stops re-rendering, so timeline updates (banner click → prepend new status, polling fetches that change displayed status references) appear as ghost cards: the post body never updates even though `card.status` is the new object.

Affected components, all of which now quote every interpolated attribute:

- `caribou-status-card`: `data-variant`, `src`, `datetime`
- `caribou-timeline`: `data-index`, `data-status-id`, `href` (sentinel)
- `caribou-thread`: `data-id`, `data-depth`
- `caribou-profile`: `data-index`, `data-status-id`
- `caribou-profile-header`: `style` (banner background-image), `src` (avatar)
- `caribou-nav-rail`: `href`
- `caribou-right-rail`: `href`

The Firefox banner-click test in `home.spec.ts` was the canary — it triggered exactly the second-render path that morphs and serializes attributes. Chromium is more permissive about the malformed tree but still flaked on the same bug under polling.

Also fixed an unrelated double-mount race in `home.spec.ts`: the auth-required test was hitting the strict-mode "two `<p>` matched" failure during Litro's atomic-swap window (router pre-renders the new `<page-home>` alongside the SSR'd one with `hidden`, then removes the old after one rAF). Added the existing `waitForSingleMount` helper before the visibility assertion.
