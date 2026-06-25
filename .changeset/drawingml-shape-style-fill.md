---
"@sobree/core": patch
---

DOCX import: render gallery-styled DrawingML shapes and inline placeholder
boxes that previously imported invisible or vanished.

- **Shape style-reference fill/geometry.** Shapes inserted from Word's
  gallery carry their fill only as a theme style reference
  (`<wps:style><a:fillRef>`), never a direct `<a:solidFill>` — so step
  banners, header pills, and the "Continue reading" arrow imported with no
  fill and vanished (taking any white text on top with them). The shape
  reader now falls back to the style fill reference, resolving its theme
  colour the same way direct fills are (`idx="0"` stays "no fill"). Adds
  preset-geometry expansion so a `rightArrow` renders as an arrow, and maps
  `round2SameRect` to a rounded rect.

- **Inline textbox rows.** A paragraph holding several tab-separated inline
  textboxes (a row of "Place Illustration here" placeholders) was collapsed
  to a single box. The inline-frame parser now claims bare inline textboxes
  when a paragraph holds a row of them and lays them across the content
  column at the paragraph's tab stops; a lone inline textbox still flows
  through the body as before. The inline-frame renderer now also paints a
  textbox border, so the placeholder boxes show their outline.

No public API change.
