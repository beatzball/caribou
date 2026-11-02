---
"@beatzball/caribou-state": patch
---

The notifications store shows rows as groups (`groups`). It uses the grouped endpoint when the server has it, and groups single notifications itself when the server answers 404. Older and newer pages join their groups with no duplicates. `withoutSilencedAccounts` takes muted and blocked accounts out of a group.
