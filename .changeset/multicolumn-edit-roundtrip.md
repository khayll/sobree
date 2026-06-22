---
"@sobree/core": patch
---

Fix content loss when editing inside a multi-column section.

A multi-column section is laid out by restructuring its blocks into
per-page column tracks (`.sobree-cols` > `.sobree-col`) for the snaking
flow. The DOM→AST read-back had no case for that layout wrapper, so on any
edit it serialised the entire column container as a single merged
paragraph — collapsing the section's paragraphs and dropping their
structure (a two-column body of four paragraphs became one). Undo masked
it; redo restored the corruption, so insert/undo/redo degraded the
document.

The read-back now un-wraps `.sobree-cols` — the exact inverse of the
render-side flow — recursing into each `.sobree-col` track in document
order (blocks move whole, never split across columns). Editing a column
now round-trips the section's blocks intact.
