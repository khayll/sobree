---
"@sobree/core": patch
---

After pasting multi-block content, the caret lands AFTER the pasted trailing
fragment instead of before it. It used to land at the start of the tail block
— ahead of the merged fragment — so pasting repeatedly inserted each copy in
front of the previous one: the standalone blocks stacked up in a row while
the fragments glued together behind the caret. Repeat pastes now lay the
content down in order, as Word does. Applies to rich HTML paste and the
structured clipboard, in body paragraphs and table cells alike.
