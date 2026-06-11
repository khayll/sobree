import type { GestureHost } from "./gestureHost";

/** Movement radius (px) within which a touch stays a tap. Taps must
 *  reach the editor untouched — caret placement, button presses. */
const SLOP_PX = 8;

/**
 * Touch gestures (mobile): one-finger drag pans, two-finger pinch zooms
 * anchored at the finger midpoint, and translating both fingers pans.
 * Mouse/pen pointers are deliberately ignored — their drag is text
 * selection, not pan. The container has `touch-action: none`, so without
 * this controller touch devices could neither scroll nor zoom.
 */
export class TouchGestures {
  private readonly container: HTMLElement;
  private readonly host: GestureHost;
  /** Live touch pointers (pointerId → last client position). */
  private readonly points = new Map<number, { x: number; y: number }>();
  /** `idle` → no touches; `tap` → one finger down, within slop; `pan` →
   *  one finger past slop; `pinch` → two fingers. */
  private mode: "idle" | "tap" | "pan" | "pinch" = "idle";
  /** First touch's start position — slop is measured from here. */
  private startX = 0;
  private startY = 0;
  /** Finger distance and scale captured when a pinch begins. */
  private pinchStartDist = 1;
  private pinchStartScale = 1;
  /** Set when a pan/pinch actually moved the stage — the synthetic click
   *  browsers fire after the touch sequence must not reach the editor
   *  (it would teleport the caret to wherever the drag ended). */
  private suppressNextClick = false;
  private readonly onPointerDown = (e: PointerEvent): void => this.handleDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.handleMove(e);
  private readonly onPointerEnd = (e: PointerEvent): void => this.handleEnd(e);
  private readonly onClickCapture = (e: MouseEvent): void => {
    if (!this.suppressNextClick) return;
    this.suppressNextClick = false;
    e.stopPropagation();
    e.preventDefault();
  };

  constructor(container: HTMLElement, host: GestureHost) {
    this.container = container;
    this.host = host;
    container.addEventListener("pointerdown", this.onPointerDown);
    container.addEventListener("pointermove", this.onPointerMove);
    container.addEventListener("pointerup", this.onPointerEnd);
    container.addEventListener("pointercancel", this.onPointerEnd);
    container.addEventListener("click", this.onClickCapture, { capture: true });
    // Older iOS Safari can still page-zoom on pinch despite
    // `touch-action: none`; its proprietary GestureEvent is cancelable.
    container.addEventListener("gesturestart", preventDefaultListener);
  }

  destroy(): void {
    const c = this.container;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerEnd);
    c.removeEventListener("pointercancel", this.onPointerEnd);
    c.removeEventListener("click", this.onClickCapture, { capture: true });
    c.removeEventListener("gesturestart", preventDefaultListener);
  }

  private handleDown(e: PointerEvent): void {
    // A fresh press of ANY pointer type means the previous gesture's
    // synthetic click (if the browser fired one) has already happened —
    // disarm so a genuine tap is never swallowed.
    this.suppressNextClick = false;
    if (e.pointerType !== "touch") return;
    this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.points.size === 1) {
      // Don't pan yet: within the slop radius this is a tap.
      this.mode = "tap";
      this.startX = e.clientX;
      this.startY = e.clientY;
    } else if (this.points.size === 2) {
      this.beginPinch();
    }
    // 3+ fingers: the first two keep driving the pinch; extras are
    // tracked only so their up-events balance.
  }

  private handleMove(e: PointerEvent): void {
    if (e.pointerType !== "touch") return;
    const prev = this.points.get(e.pointerId);
    if (!prev) return;
    this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.mode === "tap") {
      if (Math.hypot(e.clientX - this.startX, e.clientY - this.startY) < SLOP_PX) return;
      this.mode = "pan";
    }
    if (this.mode === "pan") {
      this.suppressNextClick = true;
      this.host.panBy(e.clientX - prev.x, e.clientY - prev.y);
    } else if (this.mode === "pinch") {
      this.suppressNextClick = true;
      this.movePinch(e, prev);
    }
  }

  private movePinch(e: PointerEvent, prev: { x: number; y: number }): void {
    const [a, b] = [...this.points.values()];
    if (!a || !b) return;
    // Pan by however much THIS pointer moved the midpoint (half its
    // delta), then zoom anchored at the midpoint. Together: fingers
    // moving apart zoom in place, fingers translating drag the page.
    this.host.panBy((e.clientX - prev.x) / 2, (e.clientY - prev.y) / 2);
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const next = this.pinchStartScale * (dist / this.pinchStartDist);
    if (next !== this.host.getScale()) {
      this.host.zoomTo(next, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  }

  private handleEnd(e: PointerEvent): void {
    if (e.pointerType !== "touch") return;
    if (!this.points.delete(e.pointerId)) return;
    if (this.points.size >= 2) {
      this.beginPinch(); // re-anchor on the two survivors
    } else if (this.points.size === 1) {
      // Pinch collapsed to one finger — continue as a plain pan.
      this.mode = "pan";
    } else {
      this.mode = "idle";
    }
  }

  private beginPinch(): void {
    const [a, b] = [...this.points.values()];
    if (!a || !b) return;
    this.mode = "pinch";
    this.pinchStartDist = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
    this.pinchStartScale = this.host.getScale();
  }
}

/** Shared listener identity so add/remove pair up across ctor/destroy. */
function preventDefaultListener(e: Event): void {
  e.preventDefault();
}
