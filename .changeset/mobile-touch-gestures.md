---
"@sobree/core": patch
---

Mobile touch support in the embed viewport: one-finger drag pans (with
a tap slop so caret placement still works), two-finger pinch zooms
anchored at the finger midpoint. Previously `touch-action: none` left
touch devices unable to scroll or zoom at all.
