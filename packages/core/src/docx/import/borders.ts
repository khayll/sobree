import type { BorderSpec, ParagraphBorders } from "../../doc/types";
import { wFirst } from "../shared/xml";
import { NS } from "../shared/namespaces";

const STYLE_MAP: Record<string, BorderSpec["style"]> = {
  single: "single",
  double: "double",
  dashed: "dashed",
  dotted: "dotted",
  thick: "thick",
  dotDash: "dashed",
  dashDot: "dashed",
};

function attr(el: Element, name: string): string | null {
  return el.getAttributeNS(NS.w, name) ?? el.getAttribute(`w:${name}`);
}

/**
 * Read a `<w:pBdr>` paragraph-border element into `ParagraphBorders`.
 *
 * Shared by the direct-paragraph parser AND the named-style parser: Word
 * puts the divider rules of letterhead / résumé headers on a STYLE (e.g. a
 * "Name" style's `<w:top>` rule), not on each paragraph. Reading it only
 * for direct paragraphs dropped those rules entirely (the renderer's
 * `effective.borders` cascade had nothing to apply). `none` / `nil` sides
 * are skipped (Word's explicit "no border on this side").
 */
export function readParagraphBorders(pPr: Element): ParagraphBorders | undefined {
  const pBdrEl = wFirst(pPr, "pBdr");
  if (!pBdrEl) return undefined;
  const out: ParagraphBorders = {};
  for (const side of ["top", "bottom", "left", "right", "between"] as const) {
    const child = wFirst(pBdrEl, side);
    if (!child) continue;
    const val = attr(child, "val") ?? "single";
    if (val === "none" || val === "nil") continue;
    const sz = attr(child, "sz");
    const color = attr(child, "color");
    const space = attr(child, "space");
    out[side] = {
      style: STYLE_MAP[val] ?? "single",
      sizeEighthsOfPt: sz ? Number(sz) : 4,
      color: color && color !== "auto" ? `#${color}` : "auto",
      ...(space ? { spaceTwips: Number(space) } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
