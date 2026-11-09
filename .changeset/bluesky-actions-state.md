---
"@beatzball/caribou-state": patch
---

Status actions and relationship writes accept a Bluesky ack. An ack commits the flag and the record ref and keeps the count the click set. A relationship ack is partial: with nothing cached, other fields stay unknown, and `relationshipKnown` says when Follow can show. A read is judged per field group, and the lag guard compares the record URI too. Unblock and Unmute refuse a list block or mute. A Bluesky block leaves the follow.
