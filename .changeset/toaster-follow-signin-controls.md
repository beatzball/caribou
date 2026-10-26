---
"caribou-app": patch
---

Move three more buttons onto the shared controls. The toaster's Dismiss is a
`<caribou-icon-button>`; the profile Follow button is a `<caribou-button>`,
primary for "Follow" and secondary for "Following" and "Requested", and still
reads "Unfollow" under the pointer or keyboard focus; the landing page's Sign
in is a primary submit `<caribou-button>` that shows a spinner while it
connects. The README notes that `<caribou-button>` cannot submit a form
without JavaScript.
