---
"@sobree/core": minor
---

Viewport now supports touch gestures on phones, tablets, and touch-capable
laptops. One finger drags to pan; two fingers pinch to zoom and drag to pan,
anchored about the finger midpoint. Implemented with Pointer Events so it works
across iOS Safari, Android Chrome, and other touch devices. Single-finger taps
still fall through to the editor, preserving tap-to-place-caret and
long-press-to-select. Previously the viewport only handled `wheel` events, so
touchscreen pinch/pan did nothing (touch input doesn't synthesize wheel events
the way macOS trackpads do).
