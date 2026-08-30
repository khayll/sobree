---
"@sobree/core": patch
---

Theme fonts resolve for real. `w:asciiTheme`/`w:hAnsiTheme` references
now resolve against the document's `<a:fontScheme>` — superseding stale
literal fonts, as the spec requires — so documents themed with Cambria,
Arial, Book Antiqua, or Roboto headings stop rendering in hardcoded
"Calibri Light". Body text inheriting the theme's minor font picks up
that font's true line pitch (verified against LibreOffice output), and
saving re-emits the theme linkage so retheming in Word still works.
