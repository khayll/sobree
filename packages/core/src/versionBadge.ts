/**
 * A fixed, non-interactive badge showing the `@sobree/core` version.
 *
 * Debug aid only — off by default (`SobreeOptions.versionBadge`). It lets
 * you confirm which renderer build is actually live, e.g. after a deploy
 * past a stale CDN / browser cache. No interactivity, no layout impact.
 *
 * Mounted on `document.body`, NOT the editor container: the viewport
 * applies a zoom `transform` to its slot, which would both scale the
 * badge and become its containing block (breaking `position: fixed`).
 * Body-mounting keeps it screen-bottom-centre, unscaled, always visible.
 */

import { VERSION } from "./version";

/** Mount the version badge and return a teardown that removes it. */
export function mountVersionBadge(doc: Document = document): () => void {
  const el = doc.createElement("div");
  el.className = "sobree-version-badge";
  el.textContent = `@sobree/core v${VERSION}`;
  // Decorative — keep it out of the accessibility tree and off the caret.
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "fixed",
    bottom: "6px",
    left: "50%",
    transform: "translateX(-50%)",
    pointerEvents: "none",
    userSelect: "none",
    zIndex: "2147483647",
    font: "11px/1.4 system-ui, -apple-system, sans-serif",
    color: "rgba(0, 0, 0, 0.4)",
  } satisfies Partial<CSSStyleDeclaration>);
  doc.body.appendChild(el);
  return () => el.remove();
}
