---
"@sobree/core": patch
---

Incremental render: an edit now re-renders only the block(s) that actually
changed, moving every other block's existing DOM node into the new tree
instead of rebuilding the whole document. Before, every edit ran
`renderSobreeDocument` → `host.replaceChildren()`, discarding and rebuilding
all block nodes.

Gated on an unchanged document structure signature (the context-affecting
fields a block's render depends on — page-break deferral, section index,
list grouping, outline, contextual spacing) AND byte-identical block JSON,
so a reused node's render context is provably identical; any structural
change falls back to the full render. Output is byte-identical to the full
render (guarded by a parity test) — this is a pure performance / node-stability
change. Preserved DOM nodes mean a caret or overlay in an untouched block
survives an edit, which also steadies remote-cursor overlays and avoids
re-rendering the whole document when a collaborator edits elsewhere.
