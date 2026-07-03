---
"@sobree/core": patch
---

Text after a `<w:br/>` inside the same run is no longer dropped. A
break is run *content* interleaved with `<w:t>` text, not a run type —
Word emits a single run containing a break followed by text when the
author types Shift-Enter mid-sentence and keeps typing. The importer's
early-return on the first break discarded both the line break and every
character after it (a CV lost "First-class " from its education
section; a hospital letterhead lost its whole department line). Runs
are now read as ordered segment sequences split at break boundaries,
each keeping the run's formatting.
