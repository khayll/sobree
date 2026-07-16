---
"@sobree/core": patch
---

Copy and cut now carry exactly what the selection covers. A selection ending
partway through a paragraph (spanning block boundaries) copied the WHOLE
endpoint blocks, so pasting reproduced text that was never selected — and a
cut of the same selection deleted whole blocks, taking unselected text with
it. The structured clipboard payload now slices the endpoint paragraphs to
the selected offsets and marks itself a fragment; pasting a fragment splices
at the caret through the same machinery as rich HTML paste (first/last plain
paragraphs merge into the caret paragraph's halves), mirroring Word's
paragraph-mark distinction. Whole-block copies keep their existing
paste-as-blocks behaviour, and partial cuts delete only the selected range,
merging the endpoint paragraphs.
