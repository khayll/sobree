---
"@sobree/core": patch
---

Bookmarks survive a save. `w:bookmarkStart`/`w:bookmarkEnd` markers —
TOC heading targets, cross-reference anchors, `_GoBack` — previously
dropped on import, breaking every REF/PAGEREF/TOC field in Word on the
next open. They now round-trip as zero-length marker runs at their exact
offsets: no rendered output, no cursor-position impact, carried through
collaboration. This is the foundation for native cross-reference and
table-of-contents support.
