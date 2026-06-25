---
"@sobree/core": patch
---

Copy, cut, and paste whole blocks. Copy/cut now write the selected
block(s) to the clipboard as a structured payload
(`application/x-sobree-blocks+json`, plus a `text/plain` fallback), and
paste inserts them as fresh blocks below the caret — instead of the
browser default, where a styled paragraph or table came back as plain
runs in the current block. Cut also removes the blocks (in track-changes
mode they're marked deleted). A selection that spans whole blocks (or
covers one end-to-end) is treated structurally; a partial in-block
selection stays a plain-text copy/cut. Adds two CI regression suites: the copy-block →
paste-below round-trip, and a per-block-type property-isolation check that
mutates a block and asserts the deep-diff of the whole AST touches only
the intended properties.
