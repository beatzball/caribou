---
'caribou-app': patch
---

Raise the `vite` floor to `^8.1.6` to match litro 0.17.4, which raised its own floor for security advisories. The live SSR thread test now picks a post that really is a reply with a visible parent, instead of the newest entry on the replies tab. The litro patch's comments now say the root index maps to `page-index`; the patched code is unchanged.
