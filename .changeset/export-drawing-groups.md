---
"@sobree/core": patch
---

Drawing export is now complete for every frame kind the editor models:
drawing groups (`wpg:wgp`, nested groups, child coordinate systems),
custom-geometry shapes (`a:custGeom` re-built from the imported outline),
header/footer floating drawings (re-anchored in their parts), float-placed
images (wrap side and clearance margins survive instead of degrading to
inline), and inline drawing groups — pill headings and project entries
re-emit as `<wp:inline>` groups, picture bands as the anchored pictures
they were synthesized from. The export fixpoint suite now enforces all of
these for every corpus document. Remaining documented gaps: shape-only
inline groups and even-page header/footer parts.
