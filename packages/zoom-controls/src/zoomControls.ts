import "./zoomControls.css";
import { getFloatingCorner, type Viewport } from "@sobree/core";

export type ZoomControlsPlacement =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface ZoomControlsOptions {
  /**
   * Element the dock is pinned to (positioned `absolute` inside it).
   * Typically the same element you handed to `createSobree()` /
   * `new Viewport(...)`.
   */
  container: HTMLElement;
  /** Viewport whose scale + fit are driven by the dock. */
  viewport: Viewport;
  /**
   * Element to fit when "Fit width" is pressed. Pass an `HTMLElement`
   * for a static target, or a function for a dynamic one (e.g. the
   * first paper of a paginated document).
   */
  fitWidthTarget: HTMLElement | (() => HTMLElement);
  /**
   * Element to fit when "Fit page" is pressed. Same shape as
   * `fitWidthTarget`. Common pattern: a resolver that returns the
   * paper closest to the viewport's vertical centre.
   */
  fitPageTarget: HTMLElement | (() => HTMLElement);
  /**
   * Multiplicative step per zoom-in / zoom-out click. Default `1.2`
   * (≈ 20%). Zoom-in multiplies, zoom-out divides.
   */
  zoomFactor?: number;
  /** Whether the fit-width / fit-page actions animate the pan. Default `true`. */
  animateFit?: boolean;
  /**
   * Which corner of the container the dock is pinned to. Default
   * `"bottom-right"`. A `data-placement` attribute is set on the root
   * element so consumers can target a specific corner from CSS.
   */
  placement?: ZoomControlsPlacement;
}

/**
 * Floating zoom dock pinned to the bottom-right of a container.
 * Four actions: fit-page, fit-width, zoom-out, zoom-in. Idle at 50%
 * opacity, fully opaque on hover / focus.
 *
 * Framework-free; consumers wire the targets they want fitted.
 */
export class ZoomControls {
  readonly root: HTMLElement;
  private readonly viewport: Viewport;
  private readonly fitWidthTarget: () => HTMLElement;
  private readonly fitPageTarget: () => HTMLElement;
  private readonly zoomFactor: number;
  private readonly animateFit: boolean;
  private readonly onClick: (e: MouseEvent) => void;

  constructor(opts: ZoomControlsOptions) {
    this.viewport = opts.viewport;
    this.fitWidthTarget = resolveTarget(opts.fitWidthTarget);
    this.fitPageTarget = resolveTarget(opts.fitPageTarget);
    this.zoomFactor = opts.zoomFactor ?? 1.2;
    this.animateFit = opts.animateFit ?? true;

    this.root = document.createElement("div");
    this.root.className = "sobree-zoom-controls";
    this.root.setAttribute("data-placement", opts.placement ?? "bottom-right");
    this.root.innerHTML = `
      <button type="button" data-zc-action="fit-page"  aria-label="Fit page"  title="Fit page">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <rect x="2" y="1.5" width="10" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>
          <rect x="4.5" y="4" width="5" height="6" rx="0.5" fill="currentColor"/>
        </svg>
      </button>
      <button type="button" data-zc-action="fit-width" aria-label="Fit width" title="Fit width">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M1.5 7 L4 4.5 M1.5 7 L4 9.5 M1.5 7 H12.5 M12.5 7 L10 4.5 M12.5 7 L10 9.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button type="button" data-zc-action="zoom-out" aria-label="Zoom out" title="Zoom out">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3.5 7 H10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
      <button type="button" data-zc-action="zoom-in"  aria-label="Zoom in"  title="Zoom in">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M7 3.5 V10.5 M3.5 7 H10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    // Append to the shared floating-corner container instead of
    // directly to the host, so a second corner-resident (e.g. the
    // review dock) in the same corner stacks cleanly above/below us
    // instead of overlapping.
    const placement = opts.placement ?? "bottom-right";
    getFloatingCorner(opts.container, placement).appendChild(this.root);

    this.onClick = (e) => this.handleClick(e);
    this.root.addEventListener("click", this.onClick);
  }

  destroy(): void {
    this.root.removeEventListener("click", this.onClick);
    this.root.remove();
  }

  private handleClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest("button[data-zc-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-zc-action");
    switch (action) {
      case "zoom-in":
        this.zoomFromCenter(this.zoomFactor);
        return;
      case "zoom-out":
        this.zoomFromCenter(1 / this.zoomFactor);
        return;
      case "fit-width":
        this.viewport.fitTo(this.fitWidthTarget(), "width", this.animateFit);
        return;
      case "fit-page":
        this.viewport.fitTo(this.fitPageTarget(), "contain", this.animateFit);
        return;
    }
  }

  private zoomFromCenter(factor: number): void {
    const rect = this.viewport.container.getBoundingClientRect();
    this.viewport.zoomTo(
      this.viewport.getScale() * factor,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
  }
}

function resolveTarget(
  source: HTMLElement | (() => HTMLElement),
): () => HTMLElement {
  return typeof source === "function" ? source : () => source;
}
