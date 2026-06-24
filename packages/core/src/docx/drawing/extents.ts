/**
 * Owns DrawingML sizing in EMU: `<wp:extent>` / `<a:ext cx cy>` reads and
 * the numeric-attribute primitives the other concept readers build on.
 * (914400 EMU = 1 inch; conversion to CSS happens in the renderer, not
 * here — this module stays in the document's native unit.)
 */

import type { EmuExtent } from "./model";

/** Read a numeric XML attribute; `0` when absent, missing, or non-finite. */
export function numAttr(el: Element | undefined | null, name: string): number {
  if (!el) return 0;
  const n = Number(el.getAttribute(name) ?? "0");
  return Number.isFinite(n) ? n : 0;
}

/** Read a numeric XML attribute, falling back to `fallback` when ABSENT —
 *  used for `<wps:bodyPr>` insets whose OOXML defaults are non-zero. */
export function numAttrOr(el: Element, name: string, fallback: number): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Read an EMU attribute that the caller has already null-checked; `0`
 *  for an explicitly-absent (`null`) value. Distinct from `numAttr` only
 *  in taking the raw attribute string rather than the element. */
export function emuAttr(v: string | null): number {
  if (v === null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Read an `<…:extent>` / `<…:ext>` element's `cx`/`cy` into EMU. */
export function readExtent(el: Element | undefined | null): EmuExtent {
  return { cx: numAttr(el, "cx"), cy: numAttr(el, "cy") };
}
