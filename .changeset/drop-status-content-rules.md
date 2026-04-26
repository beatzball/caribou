---
'@beatzball/caribou-design-tokens': patch
---

Drop the `.status-content` wrap and adjacent-link rules from `tokens.css`.

These selectors only ever needed to reach inside `caribou-status-card`'s rendered post HTML. Now that the card uses shadow DOM (see `caribou-elena` patch), global CSS no longer crosses into its rendered tree — keeping the rules in the global tokens stylesheet would silently apply to nothing. The card adopts its own copy of the rules onto its shadow root via Elena's `static styles`.
