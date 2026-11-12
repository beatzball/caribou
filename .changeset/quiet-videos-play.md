---
"caribou-app": patch
---

Prefer hls.js for Bluesky videos when Media Source Extensions are available, fixing playback in Vivaldi on macOS. Keep native HLS as a fallback and retry hls.js once after a native playback error.
