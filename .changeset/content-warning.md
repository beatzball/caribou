---
"caribou-app": minor
---

A post with a content warning now shows only the warning and a "Show more" button. The text, media and link card stay hidden, and load nothing, until the reader clicks it. "Show less" hides them again, and focus stays on the button. The button tells screen readers if the post is open (`aria-expanded`). Show more also shows sensitive media, which keeps its own Hide button. A boost uses the warning of the boosted post. An opened post stays open when the reader comes back to a cached page; a post with the same id from another instance does not, and a switch of account closes them all. The server renders the post closed, the same as the first client render. Without JavaScript a post with a content warning cannot be opened.
