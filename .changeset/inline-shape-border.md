---
"@sobree/core": patch
---

Inline geometric shape decorations (photo-placeholder rectangles and
similar `wps` shapes without text) now paint their outline. The
importer already resolved the shape's theme border color and width;
the inline-frame renderer applied only the fill, leaving the square a
borderless blob where Word draws a thin themed line around it.
