---
"@beatzball/caribou-state": patch
---

Add the lists store: `loadLists`, `loadList`, `createList`, `updateList`, `deleteList`, `loadListMembers`, `loadAccountLists` and `setListMember`. Each entry is kept per account. Writes show at once and roll back with a toast on failure, and an answer for an earlier account is dropped. Writes to one list or one membership run in order, so the server ends with the last change. A read that crosses a write waits and asks again.
