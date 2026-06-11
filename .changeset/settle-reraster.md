---
"@sobree/core": patch
---

Crisp text at any zoom: the viewport now uses two-phase rendering.
While a gesture is live the stage stays on a composited layer (fast but
soft); 180ms after input settles the compositor re-rasterises at the
effective scale, so text at high zoom is as sharp as a natively-sized
layout. Gesture handling is also split into dedicated wheel/touch
controllers with unit tests.
