/**
 * Owns DrawingML positioning: `<wp:positionH/V>` `relativeFrom` enums and
 * the `<wp:posOffset>` EMU offset. Where a frame is pinned and how far —
 * not how big (that's `extents.ts`) nor how text flows around it
 * (`wrap.ts`).
 */

import { NS } from "../shared/namespaces";
import { firstChildNS } from "./dom";
import type { RelativeFromH, RelativeFromV } from "./model";

/** Coerce `<wp:positionH relativeFrom>` to the AST enum; `page` default. */
export function coerceHRelativeFrom(v: string | null): RelativeFromH {
  switch (v) {
    case "page":
    case "margin":
    case "column":
      return v;
    default:
      return "page";
  }
}

/** Coerce `<wp:positionV relativeFrom>` to the AST enum; `page` default. */
export function coerceVRelativeFrom(v: string | null): RelativeFromV {
  switch (v) {
    case "page":
    case "margin":
    case "paragraph":
      return v;
    default:
      return "page";
  }
}

/** Read the `<wp:posOffset>` EMU offset of a `<wp:positionH/V>` element;
 *  `0` when the element or its offset child is absent. */
export function readPosOffset(positionEl: Element | null): number {
  if (!positionEl) return 0;
  const posOffset = firstChildNS(positionEl, NS.wp, "posOffset");
  if (!posOffset) return 0;
  const n = Number(posOffset.textContent ?? "0");
  return Number.isFinite(n) ? n : 0;
}
