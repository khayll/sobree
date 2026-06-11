/**
 * The narrow surface gesture controllers drive the Viewport through.
 * Controllers translate raw input events into these calls; the Viewport
 * owns all transform state, clamping, and raster behaviour.
 */
export interface GestureHost {
  /** Pan the stage by `(dx, dy)` CSS pixels. */
  panBy(dx: number, dy: number): void;
  /** Zoom to `scale`, anchoring the point at (clientX, clientY). */
  zoomTo(scale: number, clientX: number, clientY: number): void;
  /** Current visual scale (zoom deltas are multiplicative on this). */
  getScale(): number;
}
