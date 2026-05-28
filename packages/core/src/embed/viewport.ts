import "./viewport.css";

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
 * Gestures:
 *   - Zoom: wheel with shiftKey OR ctrlKey (macOS pinch emits ctrlKey).
 *           The point under the cursor stays under the cursor (zoom-to-cursor).
 *   - Pan:  wheel without modifiers — two-finger trackpad scroll deltas move
 *           the stage. Also supports click-drag with middle mouse or space.
 */
export class Viewport {
  readonly container: HTMLElement;
  readonly slot: HTMLElement;
  private readonly stage: HTMLElement;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private readonly minScale: number;
  private readonly maxScale: number;
  private readonly wheelZoomSensitivity: number;
  private readonly pinchZoomSensitivity: number;
  private readonly onScaleChange: ((s: number) => void) | null;
  private readonly onRenderTierChange: ((t: number) => void) | null;
  private readonly onTransformChange: (() => void) | null;
  private readonly onWheel: (e: WheelEvent) => void;
  /** Current layout-side zoom factor (integer ≥ 1). See ViewportOptions. */
  private renderTier = 1;
  /** Suppresses `onTransformChange` during the constructor's initial
   *  `applyTransform` so consumers can capture `viewport` in their
   *  callback without TDZ traps. Flipped true at the end of the ctor. */
  private constructed = false;
  // ---------- scroll-axis locking state ----------
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
   * cumulative dx crosses `X_RELEASE_THRESHOLD` — the user clearly intends
   * sustained horizontal motion.
   */
  private horizontalLock = false;

  constructor(container: HTMLElement, options: ViewportOptions = {}) {
    this.container = container;
    this.minScale = options.minScale ?? 0.25;
    this.maxScale = options.maxScale ?? 6;
    this.wheelZoomSensitivity = options.wheelZoomSensitivity ?? 0.005;
    this.pinchZoomSensitivity = options.pinchZoomSensitivity ?? 0.02;
    this.onScaleChange = options.onScaleChange ?? null;
    this.onRenderTierChange = options.onRenderTierChange ?? null;
    this.onTransformChange = options.onTransformChange ?? null;

    container.classList.add("sobree-viewport");

    this.stage = document.createElement("div");
    this.stage.className = "sobree-viewport__stage";
    this.slot = document.createElement("div");
    this.slot.className = "sobree-viewport__slot";
    this.stage.appendChild(this.slot);
    container.appendChild(this.stage);

    this.onWheel = (e: WheelEvent) => this.handleWheel(e);
    container.addEventListener("wheel", this.onWheel, { passive: false });

    this.applyTransform();
    this.constructed = true;
  }

  /** Reset pan to origin and scale to 1. */
  reset(): void {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.horizontalLock = false;
    this.gesturePrimaryAxis = null;
    this.gestureSignedDx = 0;
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
    // sideways trackpad drift to break it. Heavy horizontal deltas in
    // `applyScrollAxisLock` can still override.
    this.horizontalLock = true;
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
    this.container.removeEventListener("wheel", this.onWheel);
    this.stage.remove();
    this.container.classList.remove("sobree-viewport");
  }

  private handleWheel(e: WheelEvent): void {
    // macOS trackpad pinch synthesizes wheel events with ctrlKey=true and small
    // deltaY (~1–10). Discrete mouse wheel ticks with Shift held report ~±100
    // deltaY. They need very different sensitivities or one feels sluggish.
    const isPinch = e.ctrlKey && !e.shiftKey;
    const isWheelZoom = e.shiftKey || e.metaKey;
    if (isPinch || isWheelZoom) {
      e.preventDefault();
      const sensitivity = isPinch ? this.pinchZoomSensitivity : this.wheelZoomSensitivity;
      const factor = Math.exp(-e.deltaY * sensitivity);
      this.zoomTo(this.scale * factor, e.clientX, e.clientY);
      return;
    }
    // Trackpad two-finger scroll — pan the stage, with axis-lock.
    e.preventDefault();
    const { dx, dy } = this.applyScrollAxisLock(e.deltaX, e.deltaY);
    this.tx -= dx;
    this.ty -= dy;
    this.applyTransform();
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
    const GESTURE_GAP_MS = 150;
    const X_RELEASE_THRESHOLD = 60;
    const AXIS_NOISE = 2;
    const AXIS_RATIO = 2;

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

  private applyTransform(): void {
    // Pick a layout-side zoom tier so text rasterises at the zoomed size
    // rather than being a bitmap blit. Half-integer boundaries + a 0.5
    // zoom-out tier so low zoom levels also get a matching layout size.
    //   scale [0.35, 0.70) → tier 0.5
    //   scale [0.70, 1.40) → tier 1
    //   scale [1.40, 2.40) → tier 2
    //   scale [2.40, 3.40) → tier 3   …
    const nextTier = pickRenderTier(this.scale);
    if (nextTier !== this.renderTier) {
      this.renderTier = nextTier;
      // `zoom` is non-standard but widely supported (Chrome/Safari/Edge,
      // Firefox ≥126). It re-lays-out the subtree at `tier×` size.
      this.stage.style.zoom = String(nextTier);
      this.onRenderTierChange?.(nextTier);
    }
    // Chrome applies transforms in the post-zoom coordinate space, so a
    // `translate(tx, ty)` on an element with `zoom: k` moves by `(tx*k, ty*k)`
    // screen px. We store tx/ty in pre-zoom (container) pixels — the scheme
    // that cursor-anchored zoomTo relies on — so divide by the tier here to
    // cancel out zoom's translate multiplication. Otherwise the paper jumps
    // sideways whenever the tier rolls over.
    const visualScale = this.scale / this.renderTier;
    const translateScale = 1 / this.renderTier;
    this.stage.style.transform = `translate3d(${this.tx * translateScale}px, ${this.ty * translateScale}px, 0) scale(${visualScale})`;
    if (this.constructed) this.onTransformChange?.();
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
      const tier = this.renderTier;
      const visualScale = this.scale / tier;
      const translateScale = 1 / tier;
      stage.style.transform =
        `translate3d(${this.tx * translateScale}px, ${this.ty * translateScale}px, 0) scale(${visualScale})`;
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
      // Final tick so overlays land at the exact resting position.
      this.onTransformChange?.();
    };
    stage.addEventListener("transitionend", cleanup);
    // Safety: some transitions don't fire `transitionend` (e.g. same transform).
    window.setTimeout(cleanup, 400);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Map a visual scale to the closest layout-side zoom tier. Tiers are
 * quantised (not continuous) so we don't re-layout the subtree on every
 * wheel tick — only when the scale crosses a tier boundary. The 0.5 tier
 * handles zoom-out levels so downscaled text is also rendered at a
 * matching layout size.
 */
function pickRenderTier(scale: number): number {
  if (scale < 0.7) return 0.5;
  if (scale < 1.4) return 1;
  return Math.round(scale); // 2 for [1.4, 2.5), 3 for [2.5, 3.5), …
}
