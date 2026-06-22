---
"@sobree/core": patch
---

Render multi-panel brochures (e.g. a trifold) as the right number of pages,
with their positioned text panels on the correct page.

Three connected fixes:

- **Multi-column textboxes are positioned panels, not flow content.** A
  column-anchored textbox in a multi-column section is now kept as an
  anchored frame instead of being lifted into body flow (which stacked a
  2D panel grid into one snaking column). Single-column sections keep the
  flow treatment.
- **A body-empty page that anchors a frame no longer collapses.** A
  brochure panel page carries an absolute overlay even when its body flow
  is empty, so it survives trailing/middle empty-page collapse.
- **An empty page-break paragraph stays on its page and breaks after.** Its
  break now defers to the next block with content *or* an anchored frame
  (a float-only page is still a page), so a leading page break no longer
  pushes the whole document onto page 2.

A trifold whose entire design lives in two full-page background images plus
positioned panels now renders as two pages matching Word, instead of one
overlapping page. No layout change to other documents.
