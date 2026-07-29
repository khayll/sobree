---
"@sobree/core": patch
---

Saving no longer strips the document's supporting parts. Word settings
(`settings.xml` — default tab stop, compatibility flags), the theme
(`theme1.xml` — what style font/color references resolve against),
document metadata (`docProps`, thumbnail included), and customXml data
bindings now pass through export byte-identical. Even-page header and
footer parts round-trip too (they rendered as dropped before). A
Sobree-saved file re-opens in Word with its theme fonts, metadata, and
settings intact.
