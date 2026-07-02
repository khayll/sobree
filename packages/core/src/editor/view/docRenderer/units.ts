/**
 * OOXML measurement units → CSS conversions, in one place.
 *
 * OOXML mixes three length units:
 *   - EMU   (English Metric Units): 914400 per inch. Used by DrawingML
 *           (`<a:off>`, `<a:ext>`, `<wp:extent>`, picture sizes).
 *   - twips (twentieths of a point): 1440 per inch. Used by
 *           WordprocessingML (`<w:ind>`, `<w:spacing>`, `<w:tblW>`).
 *   - half-points / eighths-of-point: font + border sizes (handled
 *           at their own call sites; not length conversions).
 *
 * Derived constants (all exact):
 *   - 1 inch = 25.4 mm = 96 px (CSS reference pixel) = 914400 EMU = 1440 twips
 *   - 914400 / 25.4 = 36000  EMU per mm
 *   - 914400 / 96    = 9525   EMU per px
 *
 * Rounding is a SEPARATE concern from conversion. These helpers return
 * exact values; call sites that want integer mm / px (e.g. for crisp
 * image edges, or to match a historical snapshot) round explicitly.
 */

export const EMU_PER_INCH = 914400;
export const TWIPS_PER_INCH = 1440;
export const MM_PER_INCH = 25.4;
export const PX_PER_INCH = 96;

/** 914400 / 25.4 = 36000, pinned as an integer literal. Computing it
 *  as `914400 / 25.4` risks float drift (25.4 isn't exactly
 *  representable), which would change emitted CSS strings vs the
 *  literal `36000` the renderer used before this module existed. */
export const EMU_PER_MM = 36000;
/** 914400 / 96 = 9525, exact. */
export const EMU_PER_PX = 9525;

/** EMU → millimetres, exact. */
export function emuToMm(emu: number): number {
  return emu / EMU_PER_MM;
}

/** EMU → CSS pixels, exact. */
export function emuToPx(emu: number): number {
  return emu / EMU_PER_PX;
}

/**
 * Twips → millimetres, rounded to 3 decimals — finer than a twip
 * (1 twip ≈ 0.0176mm), so the source value survives unchanged while the
 * emitted CSS string stays short and stable (`2.822mm`, not
 * `2.8222222222222224mm`).
 *
 * NOT whole millimetres: Word authors spacing/indents in points
 * (`w:after="160"` is exactly 8pt = 2.822mm), and integer-mm rounding
 * distorted every value by up to ±0.5mm (±1.9px). Stacked over a page
 * of paragraphs that grows real layout past Word's — wsu-thesis's title
 * page carries ~45 spaced paragraphs whose after-spacing rounded 2.822mm
 * → 3mm, +30px on the page, spilling its last lines onto an extra page.
 * Callers formatting their own strings can use `twipsToMmExact`.
 */
export function twipsToMm(twips: number): number {
  return Math.round((twips / TWIPS_PER_INCH) * MM_PER_INCH * 1000) / 1000;
}

/** Twips → millimetres, exact (no rounding). */
export function twipsToMmExact(twips: number): number {
  return (twips / TWIPS_PER_INCH) * MM_PER_INCH;
}
