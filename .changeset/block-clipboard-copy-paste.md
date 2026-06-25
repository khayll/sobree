---
"@sobree/core": patch
---

Copy a whole block and paste it below to get a real duplicate. Copy now
writes the selected block(s) to the clipboard as a structured payload
(`application/x-sobree-blocks+json`, plus a `text/plain` fallback), and
paste inserts them as fresh blocks below the caret — instead of the
browser default, where a styled paragraph or table came back as plain
runs in the current block. A selection that spans whole blocks (or covers
one end-to-end) copies structurally; a partial in-block selection stays a
plain-text copy. Adds two CI regression suites: the copy-block →
paste-below round-trip, and a per-block-type property-isolation check that
mutates a block and asserts the deep-diff of the whole AST touches only
the intended properties.
