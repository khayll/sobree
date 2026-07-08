/**
 * Resolve a `<w:shd>` shading (pattern + fill + foreground colour) to the
 * single CSS colour Word paints for it. The one place that turns the
 * OOXML shading model into a display colour — the cell / paragraph / run
 * renderers all call it, so patterned shading is handled identically
 * everywhere.
 *
 * The shading paints a `w:val` PATTERN of the foreground `w:color` over
 * the background `w:fill` (ECMA-376 §17.18.78, ST_Shd):
 *   - `clear` / `nil` — no pattern; the cell is just the fill.
 *   - `solid` — the foreground fully covers the fill.
 *   - `pctN` — N% of the foreground bleeds over the fill; the eye reads
 *     the blend, so we composite `fill·(1−N) + color·N`.
 * `auto` resolves to Word's automatics: an auto FILL is the page white,
 * an auto foreground is the text black — so `pct40` with both `auto`
 * (a common "grey divider column") composites to ~40 % grey, which is
 * exactly what was lost when only `fill` was read (auto fill → nothing).
 */

import type { Shading } from "../../../doc/types";

const AUTO_FILL = "#ffffff";
const AUTO_FG = "#000000";

export function resolveShadingColor(shading: Shading | undefined): string | undefined {
  if (!shading) return undefined;
  const pattern = (shading.pattern || "clear").toLowerCase();
  const bg = normaliseColor(shading.fill);
  const fg = normaliseColor(shading.color);

  if (pattern === "clear" || pattern === "nil" || pattern === "none") return bg;
  // `solid` fills the cell — the author's fill is the intended colour;
  // only fall to the foreground / text-black when there is no fill.
  if (pattern === "solid") return bg ?? fg ?? AUTO_FG;

  const density = percentPattern(pattern);
  if (density !== undefined) return blend(bg ?? AUTO_FILL, fg ?? AUTO_FG, density);

  // A named texture pattern (stripes / grids) we don't composite exactly:
  // show the explicit fill if any, otherwise leave it unpainted.
  return bg;
}

/** `#rrggbb` for a real colour; `undefined` for `auto` / missing. */
function normaliseColor(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw === "#auto" ? "auto" : raw;
  if (v === "auto") return undefined;
  return v.startsWith("#") ? v : `#${v}`;
}

/** `pct40` → 0.4; `undefined` for non-percentage patterns. */
function percentPattern(pattern: string): number | undefined {
  const m = /^pct(\d+)$/.exec(pattern);
  if (!m) return undefined;
  return Math.min(100, Number(m[1])) / 100;
}

/** Composite `fg` over `bg` at density `t` (0..1), per channel. */
function blend(bg: string, fg: string, t: number): string {
  const b = parseHex(bg);
  const f = parseHex(fg);
  if (!b || !f) return bg;
  const mix = (x: number, y: number) => Math.round(x * (1 - t) + y * t);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(mix(b[0], f[0]))}${hex(mix(b[1], f[1]))}${hex(mix(b[2], f[2]))}`;
}

function parseHex(c: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(c);
  if (!m?.[1]) return undefined;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
