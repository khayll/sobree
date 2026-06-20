---
"@sobree/core": patch
---

Keep page-positioned text boxes as floating frames instead of flattening
them into the body — fixing flyer-style layouts that exploded into many
pages.

`flowDisplacingTextboxes` rewrites a displacing anchored text box into
ordinary body blocks so tall framed prose can paginate (it would
otherwise clip at the page bottom as a fixed overlay). That conversion is
only correct when the box belongs to the text flow. A poster/flyer lays
its headings and call-outs out as an absolute grid of boxes positioned
relative to the page margin; flattening those stacked every box into a
single column and overflowed the page many times over.

The flow conversion now requires the box to be anchored horizontally
relative to the text **column** — the flow's own coordinate system. A box
positioned relative to the page **margin** or **page** is an absolute
layout element and stays a positioned overlay, rendered through the same
canonical block renderer as the body. Vertical anchoring no longer decides
this on its own.
