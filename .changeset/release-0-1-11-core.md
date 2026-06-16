---
"@sobree/core": patch
---

Add an optional version badge. Pass `versionBadge: true` to
`createSobree` (or `new Sobree`) — off by default — to float a small,
greyed, non-interactive `@sobree/core v<x.y.z>` label at the
bottom-centre of the screen. It's a debug aid for confirming which
renderer build is actually live (e.g. past a stale CDN / browser cache
after a deploy) and has no other behaviour.

Also exports `VERSION`, the published `@sobree/core` version string,
baked in from `package.json` at build time.
