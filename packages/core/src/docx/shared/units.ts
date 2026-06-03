/**
 * OOXML unit conversions. Word mixes several units throughout the spec:
 * - **Half-points** (`w:sz`, `w:szCs`) — divide by 2 to get pt.
 * - **Twentieths of a point** aka "twips" (`w:spacing`, page margins in
 *   `w:pgMar`) — divide by 20 to get pt, by 567 to get mm.
 * - **EMU** (English Metric Units, `wp:extent`) — 914400 per inch,
 *   360000 per cm.
 * - **Half-points via `w:line` for line spacing** — when `w:lineRule="auto"`,
 *   the value is twentieths-of-a-point multiplied by a factor: 240 twips
 *   = single-spacing.
 *
 * One file, one place to get them wrong or right.
 */

const PT_PER_INCH = 72;
const EMU_PER_INCH = 914400;
const MM_PER_INCH = 25.4;
const TWIPS_PER_INCH = 1440;

/** Half-point integer → floating-point pt. */
export const halfPtToPt = (n: number): number => n / 2;
/** Floating-point pt → rounded half-point integer. */
export const ptToHalfPt = (pt: number): number => Math.round(pt * 2);

/** EMU → CSS px (assuming 96 DPI). */
export const emuToPx = (emu: number): number => (emu / EMU_PER_INCH) * 96;
/** CSS px → EMU. */
export const pxToEmu = (px: number): number => Math.round((px / 96) * EMU_PER_INCH);

/** Twips → mm. */
export const twipsToMm = (t: number): number => (t / TWIPS_PER_INCH) * MM_PER_INCH;
/** mm → twips. */
export const mmToTwips = (mm: number): number => Math.round((mm / MM_PER_INCH) * TWIPS_PER_INCH);

/** Twips → pt. */
export const twipsToPt = (t: number): number => (t / TWIPS_PER_INCH) * PT_PER_INCH;
/** pt → twips. */
export const ptToTwips = (pt: number): number => Math.round((pt / PT_PER_INCH) * TWIPS_PER_INCH);

/**
 * `w:line` value (in "auto" line-rule mode) for single line spacing.
 * Word treats 240 as 1.0×, so `line-height: 1.5` → `240 * 1.5 = 360`.
 */
export const SINGLE_SPACING_LINE = 240;

export const lineHeightToOoxml = (lineHeight: number): number =>
  Math.round(SINGLE_SPACING_LINE * lineHeight);
export const ooxmlLineHeightToCss = (line: number): number => line / SINGLE_SPACING_LINE;
