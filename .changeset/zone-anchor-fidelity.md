---
"@sobree/core": patch
---

Header/footer fidelity for documents with title pages and designed
zones. Four fixes that together restore Word's rendering of a CV whose
zones carried the page design: (1) zone selection is exact-type with
per-type inheritance (OOXML §17.10.3-6) — a titlePg document's missing
first footer renders BLANK on page 1 instead of borrowing the default,
a first-only header no longer leaks onto later pages, and a section
declaring only a first footer still inherits the default footer for
its body pages; (2) anchored frames understand all three OOXML
positioning forms — EMU offsets, `<wp:align>` keywords (center/right/
bottom), and Word 2010 percent offsets (`wp14:pctPos*Offset`),
including the `mc:AlternateContent` wrapper Word puts around percent
positions — so centred page frames and bottom-anchored footer bars
land where Word puts them instead of the top-left corner; (3) an
explicit `<a:noFill/>` (and `<a:ln><a:noFill/>`) overrides the shape
style's fill/line reference, and a direct outline width merges with a
style-referenced colour — outline-only frame decorations stop painting
as opaque white boxes and keep their thin themed line; (4) PAGE /
NUMPAGES fields inside zone-anchored textboxes substitute the live
page number per page instead of showing Word's stale cached value.
