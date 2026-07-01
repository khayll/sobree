import type { RunProperties } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { halfPtToPt } from "../shared/units";
import { wFirst, wToggleOn, wVal } from "../shared/xml";

/**
 * The single reader for a `<w:rPr>` (run-properties) element.
 *
 * `<w:rPr>` is ONE OOXML concept with two homes: inside a `<w:r>` (direct
 * run formatting) and inside a `<w:style>` (a style's run defaults). It
 * must therefore have ONE reader — parsing it in two places is what let
 * the run and style paths drift (direct runs silently lost double
 * underline and colour="auto"; the tri-state toggle logic was written,
 * and bug-fixed, twice). Both importers call this; the two homes can no
 * longer diverge.
 *
 * The result is the native `RunProperties` shape directly — no
 * intermediate "RunFormat" type, no mapping layer.
 *
 * Toggle properties (b/i/strike/caps) are read TRI-STATE via
 * {@link wToggleOn}: present→true, `w:val="0"`→false, absent→undefined.
 * The `false` is load-bearing at both sites (see `wToggleOn`). Combining
 * toggles across the style hierarchy (XOR / reset) is the resolver's job
 * (doc/styles.ts `mergeRunStyleLayer`), not this reader's — here we only
 * record each element's raw value.
 *
 * Returns `undefined` when the rPr contributes nothing, so callers can
 * treat "no properties" uniformly.
 */
export function readRunProperties(rPr: Element): RunProperties | undefined {
  const out: RunProperties = {};

  // <w:rStyle> — a character style reference. Resolved against the style
  // cascade at render time, layered UNDER any direct run formatting. A
  // run styled only via a char style (e.g. a "Blue" link colour) needs
  // this or it renders with just its paragraph style.
  const rStyle = wVal(wFirst(rPr, "rStyle"));
  if (rStyle) out.styleId = rStyle;

  // Toggle run properties (ECMA-376 §17.7.3) — tri-state. Bare `<w:b/>`
  // (or w:val="1"/"true") is true, `<w:b w:val="0"/>` is false, absent is
  // undefined. Word toggles the DISPLAYED glyph (case for caps, weight for
  // bold) without mutating the source text, so the round-trip preserves
  // the original characters.
  const bold = wToggleOn(wFirst(rPr, "b"));
  if (bold !== undefined) out.bold = bold;
  const italic = wToggleOn(wFirst(rPr, "i"));
  if (italic !== undefined) out.italic = italic;
  const strike = wToggleOn(wFirst(rPr, "strike"));
  if (strike !== undefined) out.strike = strike;
  const caps = wToggleOn(wFirst(rPr, "caps"));
  if (caps !== undefined) out.caps = caps;

  // <w:u> — underline. Word carries a full style enum (single/double/
  // dotted/dashed/wave/…); keep the canonical set and coerce the rest to
  // "single". A bare `<w:u/>` (no w:val) is single by OOXML default;
  // `w:val="none"` is an explicit no-underline (leaves it unset here).
  const u = wFirst(rPr, "u");
  if (u) {
    const v = wVal(u);
    if (v && v !== "none") {
      out.underline =
        v === "single" || v === "double" || v === "dotted" || v === "dashed" || v === "wave"
          ? v
          : "single";
    } else if (v === null) {
      out.underline = "single";
    }
  }

  // <w:color w:val="FF0000"/> or "auto". KEEP "auto" — a run/style that
  // sets color="auto" is deliberately overriding an inherited colour back
  // to automatic (black), e.g. ACM's "Head1" (based on the built-in blue
  // "Heading1") resetting to auto. Dropping it would let the inherited
  // colour win. The renderer maps "auto" → currentColor.
  const colorVal = wVal(wFirst(rPr, "color"));
  if (colorVal) {
    out.color = colorVal === "auto" ? "auto" : colorVal.startsWith("#") ? colorVal : `#${colorVal}`;
  }

  // <w:highlight w:val="yellow"/> — a named highlight colour ("none" = off).
  const highlight = wVal(wFirst(rPr, "highlight"));
  if (highlight && highlight !== "none") out.highlight = highlight;

  // <w:rFonts> — prefer the `w:ascii` slot, fall back to `w:hAnsi` (both
  // are the Latin-text slots). eastAsia / cs are a follow-up once we have
  // non-Latin fixtures.
  const rFonts = wFirst(rPr, "rFonts");
  if (rFonts) {
    const font =
      rFonts.getAttributeNS(NS.w, "ascii") ??
      rFonts.getAttribute("w:ascii") ??
      rFonts.getAttributeNS(NS.w, "hAnsi") ??
      rFonts.getAttribute("w:hAnsi");
    if (font) out.fontFamily = font;
  }

  // <w:sz w:val="22"/> — value is in HALF-POINTS, so 22 = 11pt.
  const sz = wVal(wFirst(rPr, "sz"));
  if (sz) {
    const pt = halfPtToPt(Number(sz));
    if (Number.isFinite(pt) && pt > 0) out.fontSizePt = pt;
  }

  // <w:vertAlign w:val="superscript"/>
  const vAlign = wVal(wFirst(rPr, "vertAlign"));
  if (vAlign === "subscript" || vAlign === "superscript") out.verticalAlign = vAlign;

  // <w:rPrChange> — a tracked FORMAT change: the inner `<w:rPr>` is a
  // snapshot of the run's properties BEFORE the edit. Recurse through this
  // same reader (the snapshot is the pre-tracking state and never carries
  // its own nested rPrChange).
  const rPrChange = wFirst(rPr, "rPrChange");
  if (rPrChange) {
    const innerRPr = wFirst(rPrChange, "rPr");
    const before = (innerRPr ? readRunProperties(innerRPr) : undefined) ?? {};
    const author =
      rPrChange.getAttributeNS(NS.w, "author") ?? rPrChange.getAttribute("w:author") ?? undefined;
    const date =
      rPrChange.getAttributeNS(NS.w, "date") ?? rPrChange.getAttribute("w:date") ?? undefined;
    out.revisionFormat = {
      before,
      ...(author !== undefined ? { author } : {}),
      ...(date !== undefined ? { date } : {}),
    };
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
