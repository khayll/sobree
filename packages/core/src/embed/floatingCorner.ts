/**
 * Shared floating-corner stack — a flex container per (host, corner)
 * that plugins append floating UIs to so multiple docks in the same
 * corner stack predictably instead of overlapping.
 *
 * The problem this solves: `@sobree/zoom-controls`, `@sobree/review`'s
 * dock, a future toast/notification plugin, etc. all want to anchor
 * to a corner of the rendering area. Each appending directly to the
 * host with `position: absolute` makes them collide.
 *
 * Each corner gets its own `<div class="sobree-floating-corner">`
 * created on first use. The container's flex direction is chosen so
 * the *first* item added sits hugging the corner, and subsequent
 * items grow toward the centre:
 *
 *   top-right    →  flex-direction: column           (grows downward)
 *   top-left     →  flex-direction: column           (grows downward)
 *   bottom-right →  flex-direction: column-reverse   (grows upward)
 *   bottom-left  →  flex-direction: column-reverse   (grows upward)
 *
 * This keeps the "primary" floating UI nearest the corner regardless
 * of which side it lives on, which matches user intuition for a
 * docked toolbar.
 *
 * The host must be `position: relative` (or otherwise establish a
 * containing block); the corner container uses `position: absolute`
 * to pin to the edge. The function does NOT modify the host's
 * positioning — that's the host owner's responsibility.
 */

export type FloatingCornerPlacement =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** Margin from the corner edge, in px. Shared so docks line up. */
const CORNER_MARGIN = 12;
/** Gap between stacked items in the corner container, in px. */
const STACK_GAP = 8;

/**
 * Return the flex container for `placement` inside `host`, creating
 * it on first call. Subsequent calls with the same `(host, placement)`
 * pair return the same element — so plugins can `appendChild` their
 * floating UI and trust they'll stack with other corner-residents
 * rather than overlap them.
 *
 * The returned element's contents are managed by the appending
 * plugins; this function only owns the container itself. To remove
 * a floating UI, just `.remove()` it — the container stays alive for
 * other tenants. Empty containers are inexpensive (4-byte `<div>` per
 * corner per host) so we don't garbage-collect them.
 */
export function getFloatingCorner(
  host: HTMLElement,
  placement: FloatingCornerPlacement,
): HTMLElement {
  const selector = `:scope > .sobree-floating-corner[data-placement="${placement}"]`;
  const existing = host.querySelector<HTMLElement>(selector);
  if (existing) return existing;
  const corner = document.createElement("div");
  corner.className = "sobree-floating-corner";
  corner.dataset.placement = placement;
  Object.assign(corner.style, {
    position: "absolute",
    display: "flex",
    flexDirection: placement.startsWith("bottom-") ? "column-reverse" : "column",
    alignItems: placement.endsWith("-right") ? "flex-end" : "flex-start",
    gap: `${STACK_GAP}px`,
    // Don't intercept clicks on the underlying paper — only the
    // children should be interactive.
    pointerEvents: "none",
    // High enough to float above paper content; popovers (which use
    // `position: fixed` on body) stay above this naturally.
    zIndex: "30",
  });
  if (placement.startsWith("top-")) corner.style.top = `${CORNER_MARGIN}px`;
  else corner.style.bottom = `${CORNER_MARGIN}px`;
  if (placement.endsWith("-right")) corner.style.right = `${CORNER_MARGIN}px`;
  else corner.style.left = `${CORNER_MARGIN}px`;
  // Re-enable pointer events on every direct child so plugins don't
  // each have to remember.
  const enablePointerOnChildren = new MutationObserver(() => {
    for (const child of Array.from(corner.children)) {
      (child as HTMLElement).style.pointerEvents = "auto";
    }
  });
  enablePointerOnChildren.observe(corner, { childList: true });
  host.appendChild(corner);
  return corner;
}
