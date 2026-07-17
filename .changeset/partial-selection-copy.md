---
"@sobree/core": patch
---

Copy and cut now carry exactly what the selection covers. A selection ending
partway through a paragraph (spanning block boundaries) copied the WHOLE
endpoint blocks, so pasting reproduced text that was never selected — and a
cut of the same selection deleted whole blocks, taking unselected text with
it. The structured clipboard payload now slices the endpoint paragraphs to
the selected offsets and records WHICH ends were sliced; pasting splices at
the caret through the same machinery as rich HTML paste. A sliced endpoint
lost its paragraph mark and merges into the caret paragraph's halves; a
COMPLETE endpoint (a fully-selected heading ahead of a partial paragraph)
keeps its paragraph identity and stands as its own block, splitting the
caret paragraph to make place — mirroring Word's paragraph-mark rule. A
paste landing at the start of a block no longer leaves an empty paragraph
above the pasted content. Whole-block copies keep their existing
paste-as-blocks behaviour, and partial cuts delete only the selected range,
merging the endpoint paragraphs.
