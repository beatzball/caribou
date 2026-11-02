---
"@beatzball/caribou-state": patch
---

`DraftMedia` has an optional `name`: the name of the file the user picked. It is stored with the draft. This is on purpose: it gives each attachment's buttons a name after a reload. The name stays in the browser and is never sent to the server.
