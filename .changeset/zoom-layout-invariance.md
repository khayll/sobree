---
"@sobree/core": patch
---

Zoom never changes layout: the viewport's layout-side zoom tiers are
retired — zooming is now a pure `transform: scale`. Previously the page
re-laid-out at quantised CSS `zoom` tiers, and because browsers scale
font metrics and the page's mm-derived width through different rounding
paths, text rewrapped and pagination shifted at tier flips. Line and
page breaks are now identical at every zoom level. The tier API
(`onRenderTierChange`, `getRenderTier`) remains for compatibility and
always reports tier 1.
