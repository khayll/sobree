import "./viewport.css";
import type { GestureHost } from "./gestureHost";
import { TouchGestures } from "./touchGestures";
import { WheelGestures } from "./wheelGestures";

export interface ViewportOptions {
  minScale?: number;
  maxScale?: number;
  /** Scale change per unit of wheel deltaY for shift+wheel. Default 0.005. */
  wheelZoomSensitivity?: number;
  /** Scale change per unit of wheel deltaY for pinch (ctrlKey). Default 0.02. */
  pinchZoomSensitivity?: number;
  onScaleChange?: (scale: number) => void;
  /**
   * Fires when the render tier changes — an integer ≥1 chosen from the
   * current scale. The stage is laid out at that tier via CSS `zoom` so
   * text rasterises at the zoomed size rather than being blitted from a
   * 1× bitmap. Callers that care about layout (e.g. a paginator) should
   * re-run their measurement + layout pass when the tier changes.
   */
  onRenderTierChange?: (tier: number) => void;
  /**
   * Fires whenever the stage transform changes — zoom, pan, programmatic
   * fit, or animated pan. Used by overlays (block toolbar, indicator)
   * that live in viewport coordinates and must follow the page through
   * any transform. Called frequently during gestures, so the handler
   * should be cheap (read-rect-and-write-style cheap).
   */
  onTransformChange?: () => void;
}

/**
 * A framework-free zoomable / pannable viewport.
 *
 * Layout:
 *   container (overflow:hidden, the element passed in)
 *     └ stage   (absolutely positioned, transform: translate(tx,ty) scale(s))
 *         └ slot (where the embedded content lives — caller mounts here)
 *
 * Input handling lives in two controllers driving this class through the
 * GestureHost interface:
 *   - WheelGestures: zoom on shift/ctrl/meta+wheel (macOS pinch emits
 *     ctrlKey), pan on bare wheel with axis-locking.
 *   - TouchGestures (mobile): one-finger drag pans (after a small slop so
 *     taps still place the caret); two-finger pinch zooms anchored at the
 *     finger midpoint. Mouse/pen drag stays text selection.
 *
 * Viewport itself implements GestureHost — panBy / zoomTo / getScale are
 * its public API, so the controllers just receive `this`.
 */
export class Viewport implements GestureHost {
  readonly container: HTMLElement;
  readonly slot: HTMLElement;
  private readonly stage: HTMLElement;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private readonly minScale: number;
  private readonly maxScale: number;
  private readonly onScaleChange: ((s: number) => void) | null;
  private readonly onRenderTierChange: ((t: number) => void) | null;
  private readonly onTransformChange: (() => void) | null;
  private readonly wheelGestures: WheelGestures;
  private readonly touchGestures: TouchGestures;
  /** Current layout-side zoom factor (integer ≥ 1). See ViewportOptions. */
  private renderTier = 1;
  /** Suppresses `onTransformChange` during the constructor's initial
   *  `applyTransform` so consumers can capture `viewport` in their
   *  callback without TDZ traps. Flipped true at the end of the ctor. */
  private constructed = false;
  /** Debounce handle for the crisp-text settle pass (see scheduleSettle). */
  private settleTimer: number | null = null;

  constructor(container: HTMLElement, options: ViewportOptions = {}) {
    const opts = resolveOptions(options);
    this.container = container;
    this.minScale = opts.minScale;
    this.maxScale = opts.maxScale;
    this.onScaleChange = opts.onScaleChange;
    this.onRenderTierChange = opts.onRenderTierChange;
    this.onTransformChange = opts.onTransformChange;

    container.classList.add("sobree-viewport");
    this.stage = createStageElement();
    this.slot = this.stage.firstElementChild as HTMLElement;
    container.appendChild(this.stage);

    this.wheelGestures = new WheelGestures(container, this, opts);
    this.touchGestures = new TouchGestures(container, this);

    this.applyTransform();
    this.constructed = true;
  }

  /** Reset pan to origin and scale to 1. */
  reset(): void {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.wheelGestures.resetLocks();
    this.applyTransform();
    this.onScaleChange?.(this.scale);
  }

  getScale(): number {
    return this.scale;
  }

  /** Integer layout-side zoom currently applied via CSS `zoom` on the stage. */
  getRenderTier(): number {
    return this.renderTier;
  }

  /**
   * Fit `target` to the viewport.
   *   - `"width"`: scale so the target fills the viewport horizontally. The
   *     vertical centre of the current view is preserved (no jump to the top
   *     of the target).
   *   - `"contain"`: scale so the entire target is visible, centred in both
   *     axes.
   * With `animate = true`, the transition runs with a CSS ease curve.
   */
  fitTo(target: HTMLElement, mode: "width" | "contain", animate = false): void {
    const containerRect = this.container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const stageRect = this.stage.getBoundingClientRect();
    const s = this.scale;

    const naturalW = targetRect.width / s;
    const naturalH = targetRect.height / s;
    const naturalL = (targetRect.left - stageRect.left) / s;
    const naturalT = (targetRect.top - stageRect.top) / s;

    const padding = 32;
    const availW = containerRect.width - padding * 2;
    const availH = containerRect.height - padding * 2;

    const sW = availW / naturalW;
    const sH = availH / naturalH;
    const sNew = clamp(mode === "width" ? sW : Math.min(sW, sH), this.minScale, this.maxScale);

    // Horizontal: centre target in the container.
    const txNew = containerRect.width / 2 - (naturalL + naturalW / 2) * sNew;
    // Vertical: for "width", pin whatever's at the current view's vertical
    // centre so the fit feels like a pure zoom — not a scroll-to-top. For
    // "contain", centre the target.
    let tyNew: number;
    if (mode === "width") {
      const localCenterY = (containerRect.height / 2 - this.ty) / s;
      tyNew = containerRect.height / 2 - localCenterY * sNew;
    } else {
      tyNew = containerRect.height / 2 - (naturalT + naturalH / 2) * sNew;
    }

    this.scale = sNew;
    this.tx = txNew;
    this.ty = tyNew;
    // Engage the sticky horizontal-scroll lock: fit-* deliberately picks an
    // X alignment (centre / paper-edge), so we don't want accidental
    // sideways trackpad drift to break it. Heavy horizontal deltas in the
    // wheel controller's axis lock can still override.
    this.wheelGestures.engageHorizontalLock();
    if (animate) this.applyTransformAnimated();
    else this.applyTransform();
    this.onScaleChange?.(this.scale);
  }

  /**
   * Pan the stage by `(dx, dy)` CSS pixels. Optional `animate` runs the
   * same cubic-ease transition fit-to-page uses; unflagged pans apply
   * instantly.
   */
  panBy(dx: number, dy: number, opts: { animate?: boolean } = {}): void {
    if (dx === 0 && dy === 0) return;
    this.tx += dx;
    this.ty += dy;
    if (opts.animate) this.applyTransformAnimated();
    else this.applyTransform();
  }

  /** Zoom to `nextScale`, anchoring the point at (clientX, clientY) in container space. */
  zoomTo(nextScale: number, clientX: number, clientY: number): void {
    const clamped = clamp(nextScale, this.minScale, this.maxScale);
    if (clamped === this.scale) return;

    const rect = this.container.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;

    // World-space point under the cursor before zoom:
    //   w = (cursor - translate) / scale
    // After zoom we want that same world point under cursor:
    //   cursor = w * newScale + newTranslate
    // => newTranslate = cursor - w * newScale
    const wx = (cx - this.tx) / this.scale;
    const wy = (cy - this.ty) / this.scale;

    this.scale = clamped;
    this.tx = cx - wx * clamped;
    this.ty = cy - wy * clamped;
    this.applyTransform();
    this.onScaleChange?.(this.scale);
  }

  destroy(): void {
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.wheelGestures.destroy();
    this.touchGestures.destroy();
    this.stage.remove();
    this.container.classList.remove("sobree-viewport");
  }

  private applyTransform(): void {
    // Tier is permanently 1 (see pickRenderTier) — this branch never
    // fires; it stays so the tier plumbing remains a single code path.
    const nextTier = pickRenderTier(this.scale);
    if (nextTier !== this.renderTier) {
      this.renderTier = nextTier;
      // `zoom` is non-standard but widely supported (Chrome/Safari/Edge,
      // Firefox ≥126). It re-lays-out the subtree at `tier×` size.
      this.stage.style.zoom = String(nextTier);
      this.onRenderTierChange?.(nextTier);
    }
    // Fast path while the gesture is live: `will-change: transform` (via
    // .is-gesturing) plus a 3D transform keep the stage on its own
    // compositor layer, so each wheel tick / pinch frame just stretches
    // the cached texture — soft but 60fps. The settle pass swaps to a
    // crisp re-raster once input goes quiet.
    this.stage.classList.add("is-gesturing");
    this.stage.style.transform = this.transformCss(true);
    this.scheduleSettle();
    if (this.constructed) this.onTransformChange?.();
  }

  /**
   * The stage transform, expressed in the render tier's coordinate space.
   * Chrome applies transforms post-`zoom`, so a `translate(tx, ty)` on an
   * element with `zoom: k` moves by `(tx*k, ty*k)` screen px. We store
   * tx/ty in pre-zoom (container) pixels — the scheme cursor-anchored
   * zoomTo relies on — so divide by the tier to cancel zoom's translate
   * multiplication. (Tier is permanently 1; kept for the single code path.)
   *
   * `threeD` selects the gesture-time form (`translate3d` — forces a
   * compositor layer) vs the settled form (plain `translate` — lets the
   * compositor drop the layer pin and re-rasterise text at the effective
   * scale). Same matrix either way; only raster-cache behaviour differs.
   */
  private transformCss(threeD: boolean): string {
    const visualScale = this.scale / this.renderTier;
    const x = this.tx / this.renderTier;
    const y = this.ty / this.renderTier;
    return threeD
      ? `translate3d(${x}px, ${y}px, 0) scale(${visualScale})`
      : `translate(${x}px, ${y}px) scale(${visualScale})`;
  }

  /**
   * Crisp-text pass: once no transform has been written for SETTLE_MS,
   * drop `will-change` and the 3D form so the compositor re-rasterises
   * the (now static) stage at `devicePixelRatio × scale` — text is then
   * as sharp at 3× as a 3×-laid-out page, with zero layout involvement.
   * Both pins are needed: either `will-change: transform` or a 3D
   * transform alone keeps browsers (Safari especially) stretching the
   * stale 1× texture. The next gesture frame re-pins before moving.
   */
  private scheduleSettle(): void {
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      // Mid-animation, retargeting the transition to the 2D form would
      // restart its easing; the animation's own cleanup settles instead.
      if (this.stage.classList.contains("is-animating")) return;
      this.settle();
    }, SETTLE_MS);
  }

  private settle(): void {
    this.stage.classList.remove("is-gesturing");
    this.stage.style.transform = this.transformCss(false);
    // Same matrix as the gesture-time transform — nothing moved, so
    // overlay listeners don't need an onTransformChange kick.
  }

  /**
   * Apply the current transform with a CSS transition. Used only for
   * programmatic fits — wheel pan/zoom must stay instant or feel sluggish.
   *
   * If the target scale falls into a different render tier, we DON'T flip
   * `stage.style.zoom` mid-flight: that property can't transition, so the
   * layout would snap instantly while the `transform` keeps easing — the
   * visible "weird reset" before the animation. Instead, we keep the
   * current tier through the transition, write the transform expressed in
   * THAT tier's coordinate space (visually identical to the same transform
   * in any other tier — tier is just a layout-quality choice), and snap to
   * the target tier on `transitionend`.
   */
  private applyTransformAnimated(): void {
    const stage = this.stage;
    const targetTier = pickRenderTier(this.scale);
    const tierChange = targetTier !== this.renderTier;

    stage.classList.add("is-animating");
    if (tierChange) {
      // Write the target visual transform in the CURRENT tier's space.
      stage.style.transform = this.transformCss(true);
      // applyTransform fires onTransformChange; we skipped it above so
      // overlay listeners still need a kick.
      this.onTransformChange?.();
    } else {
      this.applyTransform();
    }

    // Drive overlays (toolbar, indicator) per-frame while the CSS
    // transition is in flight so they track the moving page rather
    // than snapping to the final position at the end.
    let done = false;
    let rafId = 0;
    const tick = () => {
      if (done) return;
      this.onTransformChange?.();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const cleanup = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(rafId);
      stage.classList.remove("is-animating");
      stage.removeEventListener("transitionend", cleanup);
      // Snap layout-side zoom to the right tier now. Visually identical
      // to what's on screen — only re-rasterises text at the new
      // resolution.
      if (tierChange) this.applyTransform();
      // The transition has landed — go crisp immediately rather than
      // waiting out the settle debounce.
      if (this.settleTimer !== null) {
        window.clearTimeout(this.settleTimer);
        this.settleTimer = null;
      }
      this.settle();
      // Final tick so overlays land at the exact resting position.
      this.onTransformChange?.();
    };
    stage.addEventListener("transitionend", cleanup);
    // Safety: some transitions don't fire `transitionend` (e.g. same
    // transform) — force cleanup just past the 320ms transition.
    window.setTimeout(cleanup, TRANSITION_CLEANUP_MS);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** All ViewportOptions resolved to their defaults. */
function resolveOptions(options: ViewportOptions) {
  return {
    minScale: options.minScale ?? 0.25,
    maxScale: options.maxScale ?? 6,
    wheelZoomSensitivity: options.wheelZoomSensitivity ?? 0.005,
    pinchZoomSensitivity: options.pinchZoomSensitivity ?? 0.02,
    onScaleChange: options.onScaleChange ?? null,
    onRenderTierChange: options.onRenderTierChange ?? null,
    onTransformChange: options.onTransformChange ?? null,
  };
}

/** The stage div with the slot div as its only child. */
function createStageElement(): HTMLElement {
  const stage = document.createElement("div");
  stage.className = "sobree-viewport__stage";
  const slot = document.createElement("div");
  slot.className = "sobree-viewport__slot";
  stage.appendChild(slot);
  return stage;
}

/**
 * Quiet time after the last transform write before the crisp-text settle
 * pass runs. Long enough that successive wheel ticks / pinch frames of
 * one gesture never trigger it (they arrive every ~8–50ms); short enough
 * that text snaps sharp the moment the user pauses.
 */
const SETTLE_MS = 180;

/** Fallback delay for the fit-animation cleanup — slightly past the
 *  320ms `is-animating` transition (see viewport.css). */
const TRANSITION_CLEANUP_MS = 400;

/**
 * Layout-side zoom tiers are RETIRED — this always returns 1 (pure
 * `transform: scale`). The tier mechanism re-laid-out the page at CSS
 * `zoom: k` for sharper text, assuming zoomed layout is proportionally
 * identical to 1×. It is not: browsers scale font metrics and the
 * page's mm-derived width through different rounding paths, so text
 * REWRAPS at tier flips (measured: the same paragraph wrapped 7 lines
 * at tier 1 and 4 at tier 0.5) and pagination shifts with it — zoom
 * visibly changed line and page breaks, violating the WYSIWYG
 * invariant that zoom is a pure visual magnifier. Modern compositors
 * re-rasterise text at the current transform scale anyway, so
 * sharpness no longer needs layout zoom. The tier plumbing (callback,
 * getter) stays for API compatibility; it simply never leaves 1.
 */
function pickRenderTier(_scale: number): number {
  return 1;
}
