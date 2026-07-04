---
"@sobree/core": patch
---

Duotone-textured theme fills resolve to the texture's TRUE average
colour: the theme image is decoded once at import, its mean linear
luminance measured, and the duotone endpoints (keyed dark→light by
lightness, not listing order) blended at that point. The previous
endpoint-midpoint stand-in rendered a CV's page-frame ring a heavier,
darker grey than Word; it remains the fallback where image decode is
unavailable.
