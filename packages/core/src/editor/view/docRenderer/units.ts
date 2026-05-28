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
 * Twips → millimetres, ROUNDED to the nearest whole millimetre.
 *
 * Word's body-geometry values (indents, spacing, column gaps) are
 * authored in whole points / mm and survive a round-trip as twips;
 * rounding to integer mm here keeps the emitted CSS stable (`5mm`,
 * not `4.97mm`) and matches the renderer's long-standing output that
 * the oracle snapshots are blessed against. Callers needing sub-mm
 * precision should use `twipsToMmExact`.
 */
export function twipsToMm(twips: number): number {
  return Math.round((twips / TWIPS_PER_INCH) * MM_PER_INCH);
}

/** Twips → millimetres, exact (no rounding). */
export function twipsToMmExact(twips: number): number {
  return (twips / TWIPS_PER_INCH) * MM_PER_INCH;
}
