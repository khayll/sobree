---
"@sobree/core": patch
---

More DOCX paragraph-import fidelity fixes:

- **`Title`-styled paragraphs** keep their own style instead of being
  re-styled as `Heading1` — so a document title renders in its authored
  display font/size, not the heading font.
- **`<w:numId w:val="0">`** is honoured as OOXML's "no numbering"
  sentinel (it cancels a list inherited from the paragraph style), rather
  than rendered as a stray ordered-list marker that over-printed the text
  and forced a phantom indent.
