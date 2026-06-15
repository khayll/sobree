import type { GestureHost } from "./gestureHost";

/** Wheel events ≤ this far apart belong to the same gesture. */
const GESTURE_GAP_MS = 150;
/** Signed cumulative dx that releases the axis locks. */
const X_RELEASE_THRESHOLD = 60;
/** Per-event |dx|+|dy| below this is too noisy to pick a dominant axis. */
const AXIS_NOISE = 2;
/** One axis must dominate the other by this factor to lock onto it. */
const AXIS_RATIO = 2;

export interface WheelGestureOptions {
  /** Scale change per unit of wheel deltaY for shift+wheel. */
  wheelZoomSensitivity: number;
  /** Scale change per unit of wheel deltaY for pinch (ctrlKey). */
  pinchZoomSensitivity: number;
}

/**
 * Wheel gestures: zoom on shift/ctrl/meta+wheel (macOS trackpad pinch
 * synthesises ctrlKey wheel events), pan on bare wheel — with an
 * axis-lock so a nearly-vertical swipe doesn't drift the paper sideways.
 */
export class WheelGestures {
  private readonly container: HTMLElement;
  private readonly host: GestureHost;
  private readonly opts: WheelGestureOptions;
  /** Timestamp of the last wheel event, used to delimit gestures. */
  private gestureLastTime = 0;
  /** Dominant axis for the current gesture. Null until detected, cleared at gesture end. */
  private gesturePrimaryAxis: "x" | "y" | null = null;
  /**
   * Signed cumulative dx within the current gesture. Drives lock release:
   * wobble (±3-5px back-and-forth) cancels out; sustained one-way motion
   * accumulates past the threshold quickly. Reset at gesture end.
   */
  private gestureSignedDx = 0;
  /**
   * Sticky horizontal-lock flag. Engaged by `fitTo` so alignment survives
   * gentle diagonal trackpad gestures; broken when the gesture's signed
   * cumulative dx crosses `X_RELEASE_THRESHOLD` — the user clearly
   * intends sustained horizontal motion.
   */
  private horizontalLock = false;
  private readonly onWheel = (e: WheelEvent): void => this.handleWheel(e);

  constructor(container: HTMLElement, host: GestureHost, opts: WheelGestureOptions) {
    this.container = container;
    this.host = host;
    this.opts = opts;
    container.addEventListener("wheel", this.onWheel, { passive: false });
  }

  destroy(): void {
    this.container.removeEventListener("wheel", this.onWheel);
  }

  /** Engage the sticky horizontal lock (fit-* picked an X alignment). */
  engageHorizontalLock(): void {
    this.horizontalLock = true;
  }

  /** Clear all gesture and lock state (viewport reset). */
  resetLocks(): void {
    this.horizontalLock = false;
    this.gesturePrimaryAxis = null;
    this.gestureSignedDx = 0;
  }

  private handleWheel(e: WheelEvent): void {
    // macOS trackpad pinch synthesizes wheel events with ctrlKey=true and small
    // deltaY (~1–10). Discrete mouse wheel ticks with Shift held report ~±100
    // deltaY. They need very different sensitivities or one feels sluggish.
    const isPinch = e.ctrlKey && !e.shiftKey;
    const isWheelZoom = e.shiftKey || e.metaKey;
    if (isPinch || isWheelZoom) {
      e.preventDefault();
      const sensitivity = isPinch ? this.opts.pinchZoomSensitivity : this.opts.wheelZoomSensitivity;
      const factor = Math.exp(-e.deltaY * sensitivity);
      this.host.zoomTo(this.host.getScale() * factor, e.clientX, e.clientY);
      return;
    }
    // Trackpad two-finger scroll — pan the stage, with axis-lock.
    e.preventDefault();
    const { dx, dy } = this.applyScrollAxisLock(e.deltaX, e.deltaY);
    this.host.panBy(-dx, -dy);
  }

  /**
   * Axis-lock for pan gestures:
   *   - Within a gesture (events ≤ GESTURE_GAP_MS apart), a clear dominant
   *     axis zeros the other axis so a nearly-vertical swipe doesn't also
   *     drift the paper sideways.
   *   - An explicit `horizontalLock` set by `fitTo` survives across gestures,
   *     keeping fit-page / fit-width alignment stable.
   *   - Both locks release when the gesture's signed cumulative dx crosses
   *     `X_RELEASE_THRESHOLD`. Signed sum cancels wobble (back-and-forth
   *     averages to zero) while sustained one-way motion accumulates fast.
   */
  private applyScrollAxisLock(rawDx: number, rawDy: number): { dx: number; dy: number } {
    const now = performance.now();
    if (now - this.gestureLastTime > GESTURE_GAP_MS) {
      this.gesturePrimaryAxis = null;
      this.gestureSignedDx = 0;
    }
    this.gestureLastTime = now;
    this.gestureSignedDx += rawDx;

    // Sustained or strong horizontal intent releases both locks. Wobble
    // (±3-5px events that cancel) stays well below the threshold.
    if (Math.abs(this.gestureSignedDx) >= X_RELEASE_THRESHOLD) {
      this.horizontalLock = false;
      this.gesturePrimaryAxis = null;
      return { dx: rawDx, dy: rawDy };
    }

    let dx = rawDx;
    let dy = rawDy;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (this.gesturePrimaryAxis === null && absDx + absDy > AXIS_NOISE) {
      if (absDx * AXIS_RATIO < absDy) this.gesturePrimaryAxis = "y";
      else if (absDy * AXIS_RATIO < absDx) this.gesturePrimaryAxis = "x";
    }

    if (this.gesturePrimaryAxis === "y") dx = 0;
    else if (this.gesturePrimaryAxis === "x") dy = 0;
    if (this.horizontalLock) dx = 0;

    return { dx, dy };
  }
}
