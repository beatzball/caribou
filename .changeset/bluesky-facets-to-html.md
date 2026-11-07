---
"@beatzball/caribou-bluesky-client": patch
---

`renderFacets(text, facets)` now turns a Bluesky post's text and facets into HTML. It cuts by UTF-8 byte ranges, drops bad or overlapping facets without throwing, keeps only http and https links, shows the real URI when link text names another host, links mentions by DID, and links tags to `/tags/<tag>?net=bsky`. The output passes the shared DOMPurify config unchanged.
