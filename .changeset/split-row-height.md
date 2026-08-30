---
"@sobree/core": patch
---

A table row split across pages no longer re-applies its `w:trHeight`
minimum to every fragment. Newsletter-style layouts built on a tall
scaffold row (a 226mm row split across pages rendered as three
nearly-full-height fragments, one of them blank) now paginate close to
Word: the snap-ed corpus newsletters dropped from 4 pages to 3 and
their page-text agreement with the LibreOffice reference jumped from
0.42/0.23 to 0.86/0.51.
