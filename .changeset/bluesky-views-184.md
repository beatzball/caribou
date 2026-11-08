---
"caribou-app": patch
---

Bluesky views behind the flag (#184). A Bluesky account's Home is the Following feed, with the new-posts banner and "Many new posts" when a catch-up does not meet the top post. Profiles (posts, replies, media) and threads render on the client for a Bluesky route. The nav hides Local, Public, Search and Lists for a Bluesky account. The status card, the quote card and the profile header apply Bluesky moderation: list filtering, label covers with Show only when allowed, media and card images, avatars and banners, and the reader veil. A timeline or a profile that is empty but has a cursor keeps its "Older posts" anchor and shows the empty notice only at the real end.
