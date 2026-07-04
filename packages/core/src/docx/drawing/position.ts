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

/**
 * Locate an anchor's `<wp:positionH>` / `<wp:positionV>`. Usually a
 * direct child — but Word wraps a PERCENT-form position in
 * `<mc:AlternateContent>` (the `mc:Choice Requires="wp14"` branch holds
 * the pct form, the `mc:Fallback` a plain EMU offset for old readers).
 * Per ECMA-376 §23.2 a consumer picks ONE branch; we prefer Choice —
 * the same policy as the part-level `stripMcFallbacks` — so the pct
 * form wins whether or not fallbacks were stripped upstream.
 */
export function findAnchorPositionEl(
  anchor: Element,
  localName: "positionH" | "positionV",
): Element | null {
  const direct = firstChildNS(anchor, NS.wp, localName);
  if (direct) return direct;
  for (const branchName of ["Choice", "Fallback"] as const) {
    for (const child of Array.from(anchor.children)) {
      if (child.namespaceURI !== NS.mc || child.localName !== "AlternateContent") continue;
      for (const branch of Array.from(child.children)) {
        if (branch.namespaceURI !== NS.mc || branch.localName !== branchName) continue;
        const el = firstChildNS(branch, NS.wp, localName);
        if (el) return el;
      }
    }
  }
  return null;
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

/** Alignment keyword inside `<wp:positionH/V>` — one of Word's three
 *  positioning forms (the others: EMU `<wp:posOffset>` and percent
 *  `<wp14:pctPos*Offset>`). Book-fold values (`inside`/`outside`)
 *  collapse onto their odd-page equivalents — Sobree renders a
 *  single-sided page model. */
export function readPosAlign(
  positionEl: Element | null,
): "left" | "center" | "right" | "top" | "bottom" | undefined {
  const align = positionEl ? firstChildNS(positionEl, NS.wp, "align") : null;
  switch (align?.textContent) {
    case "left":
    case "center":
    case "right":
    case "top":
    case "bottom":
      return align.textContent;
    case "inside":
      return positionEl?.localName === "positionV" ? "top" : "left";
    case "outside":
      return positionEl?.localName === "positionV" ? "bottom" : "right";
    default:
      return undefined;
  }
}

/**
 * Percent SIZING `<wp14:sizeRelH relativeFrom><wp14:pctWidth>` /
 * `<wp14:sizeRelV><wp14:pctHeight>` (Word 2010 extension). When
 * present and non-zero, the shape's rendered size is the fraction of
 * the page or margin box — `<wp:extent>` is only the LAST-COMPUTED
 * size and goes stale when the layout context changes (a CV's footer
 * frame declares 108.5% of the margin box next to an extent computed
 * under different margins; honouring the extent drew the page-frame
 * ring 0.27in too far in on every side). A `0` percent means "not
 * percent-sized" and keeps the extent. The exotic bases
 * (left/right/top/bottomMargin, inside/outsideMargin) coerce to
 * `margin`.
 */
export function readPctSize(anchor: Element): {
  pctWidth?: number;
  pctWidthFrom?: "page" | "margin";
  pctHeight?: number;
  pctHeightFrom?: "page" | "margin";
} {
  const out: ReturnType<typeof readPctSize> = {};
  const read = (
    tag: "sizeRelH" | "sizeRelV",
    pctTag: "pctWidth" | "pctHeight",
  ): { fraction: number; base: "page" | "margin" } | undefined => {
    const rel = firstChildNS(anchor, NS.wp14, tag);
    const pct = rel ? firstChildNS(rel, NS.wp14, pctTag) : null;
    const n = Number(pct?.textContent ?? "");
    if (!Number.isFinite(n) || n <= 0) return undefined;
    const base = rel?.getAttribute("relativeFrom") === "page" ? "page" : "margin";
    return { fraction: n / 100000, base };
  };
  const h = read("sizeRelH", "pctWidth");
  if (h) {
    out.pctWidth = h.fraction;
    out.pctWidthFrom = h.base;
  }
  const v = read("sizeRelV", "pctHeight");
  if (v) {
    out.pctHeight = v.fraction;
    out.pctHeightFrom = v.base;
  }
  return out;
}

/** Percent-based offset `<wp14:pctPosHOffset>` / `<wp14:pctPosVOffset>`
 *  (Word 2010 extension), normalised to a 0–1 fraction of the
 *  `relativeFrom` base extent (the stored unit is 1/1000 of a percent:
 *  `100000` = 100%). `undefined` when absent or non-numeric. */
export function readPctPos(positionEl: Element | null): number | undefined {
  if (!positionEl) return undefined;
  const pct =
    firstChildNS(positionEl, NS.wp14, "pctPosHOffset") ??
    firstChildNS(positionEl, NS.wp14, "pctPosVOffset");
  if (!pct) return undefined;
  const n = Number(pct.textContent ?? "");
  return Number.isFinite(n) ? n / 100000 : undefined;
}
