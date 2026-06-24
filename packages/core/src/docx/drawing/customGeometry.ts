/**
 * DrawingML custom geometry → SVG path.
 *
 * Word draws wordmarks, logo cuts, and other bespoke shapes as a
 * `<a:custGeom>` whose `<a:pathLst>` holds one or more `<a:path w h>`
 * coordinate boxes filled with move / line / curve commands. We translate
 * those commands straight into an SVG path `d` string in the path's own
 * coordinate units; the renderer drops it into an `<svg>` sized to the
 * shape's box (`preserveAspectRatio="none"`), so the mark scales to
 * wherever the shape resolves on the page.
 *
 * Supported: moveTo, lnTo, cubicBezTo, quadBezTo, close — the commands
 * authored shapes actually use. Subpaths (a glyph with a counter, e.g.
 * the "O" in a wordmark) come through as separate `M…Z` runs in one `d`,
 * so an even-odd fill punches the holes. An unrecognised command (e.g.
 * the rare arcTo) is skipped rather than aborting the whole path.
 *
 * Pure: XML in, plain data out. No DOM, no side effects.
 */

import { NS } from "../shared/namespaces";

/** A custom-geometry outline as an SVG path in its own coordinate box. */
export interface ShapePath {
  /** Path-space width (`<a:path w>`), the viewBox x-extent. */
  widthEmu: number;
  /** Path-space height (`<a:path h>`), the viewBox y-extent. */
  heightEmu: number;
  /** SVG path data in the `widthEmu × heightEmu` coordinate box. */
  d: string;
}

/**
 * Parse a `<a:custGeom>` into an SVG path, or `null` when it carries no
 * usable outline (no `<a:path>`, a zero-area box, or only unsupported
 * commands).
 */
export function parseCustomGeometry(custGeom: Element): ShapePath | null {
  const pathLst = childNS(custGeom, "pathLst");
  if (!pathLst) return null;
  const paths = childrenNS(pathLst, "path");
  if (paths.length === 0) return null;

  // The first path's box defines the coordinate space. Authored logos use
  // a single path; any extra paths reuse the same box (they're subpaths
  // of the same mark), so one viewBox covers them.
  const widthEmu = num(paths[0]!, "w");
  const heightEmu = num(paths[0]!, "h");
  if (widthEmu <= 0 || heightEmu <= 0) return null;

  const segments: string[] = [];
  for (const path of paths) {
    for (const cmd of Array.from(path.children)) {
      if (cmd.namespaceURI !== NS.a) continue;
      const seg = commandToSvg(cmd);
      if (seg) segments.push(seg);
    }
  }
  const d = segments.join(" ");
  if (!d) return null;
  return { widthEmu, heightEmu, d };
}

function commandToSvg(cmd: Element): string | null {
  const p = points(cmd);
  switch (cmd.localName) {
    case "moveTo":
      return p[0] ? `M ${p[0][0]} ${p[0][1]}` : null;
    case "lnTo":
      return p[0] ? `L ${p[0][0]} ${p[0][1]}` : null;
    case "cubicBezTo":
      return p.length >= 3
        ? `C ${p[0]![0]} ${p[0]![1]} ${p[1]![0]} ${p[1]![1]} ${p[2]![0]} ${p[2]![1]}`
        : null;
    case "quadBezTo":
      return p.length >= 2 ? `Q ${p[0]![0]} ${p[0]![1]} ${p[1]![0]} ${p[1]![1]}` : null;
    case "close":
      return "Z";
    default:
      // arcTo and any future command: skip the segment, keep the shape.
      return null;
  }
}

function points(cmd: Element): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const pt of Array.from(cmd.children)) {
    if (pt.namespaceURI === NS.a && pt.localName === "pt") {
      out.push([num(pt, "x"), num(pt, "y")]);
    }
  }
  return out;
}

function childNS(parent: Element, local: string): Element | null {
  for (const c of Array.from(parent.children)) {
    if (c.namespaceURI === NS.a && c.localName === local) return c;
  }
  return null;
}

function childrenNS(parent: Element, local: string): Element[] {
  return Array.from(parent.children).filter(
    (c) => c.namespaceURI === NS.a && c.localName === local,
  );
}

function num(el: Element, name: string): number {
  const n = Number(el.getAttribute(name) ?? "0");
  return Number.isFinite(n) ? n : 0;
}
