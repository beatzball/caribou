---
"caribou-app": minor
---

Status card actions (reply, boost, favourite, bookmark) now use `<caribou-icon-button>`, and the boost attribution icon uses `<caribou-icon>`. Behaviour is the same: signed out, each action stays focusable with its "Sign in to…" hint. Signed in, the tooltip names the action.

`<caribou-icon-button>` gains `soft-disabled` (stays in the tab order with `aria-disabled`; clicks are swallowed), `hint` (a tooltip in place of the label), `description` (read after the name, from the button's own shadow root) and `variant="ghost"` (borderless and muted; `--caribou-icon-button-pressed-fg` sets the pressed colour). `<caribou-icon>` gains `filled` and `--caribou-icon-fill`.
