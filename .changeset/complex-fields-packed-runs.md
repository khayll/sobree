---
"@sobree/core": patch
---

Complex fields (`w:fldChar`/`w:instrText`) are read child-by-child
within each run — per ECMA-376 they are run CONTENT, and producers may
legally pack a whole field (begin + instruction + separate + end) into
one run. Packed PAGE/NUMPAGES footers ("Page 1 of 2") previously lost
the instruction and swallowed neighbouring literal runs.
