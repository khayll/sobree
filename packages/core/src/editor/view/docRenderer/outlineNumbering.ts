/**
 * Heading outline numbering — "1", "1.1", "1.2", "2" prefixes on headings
 * whose paragraph style links a numbering definition (`<w:numPr>` on a
 * `HeadingN`-derived style). Computed in one document-order pass that
 * maintains a counter per outline level; the renderer stamps the result
 * as a `data-outline-number` attribute (a CSS `::before` marker, so the
 * number stays out of the editable text and selection).
 *
 * Scope: heading styles only. A non-heading style that links numbering is
 * an ordinary list (rendered as `<li>` in an `<ol>`), not an outline —
 * so we gate on the style's basedOn chain reaching a built-in `HeadingN`.
 */

import type { Block, NamedStyle, NumberingDefinition } from "../../../doc/types";

/**
 * Map of body-block index → formatted outline number ("1", "1.1", …) for
 * every heading paragraph that carries style-linked numbering.
 */
export function computeOutlineNumbers(
  blocks: readonly Block[],
  styles: readonly NamedStyle[],
  numbering: readonly NumberingDefinition[],
): Map<number, string> {
  const out = new Map<number, string>();
  if (styles.length === 0 || numbering.length === 0) return out;
  const counters: number[] = [];

  blocks.forEach((block, i) => {
    if (block.kind !== "paragraph") return;
    // A paragraph's OWN numbering makes it a list item; outline numbering
    // comes from the STYLE.
    if (block.properties.numbering) return;
    const styleNum = resolveHeadingNumbering(styles, block.properties.styleId);
    if (!styleNum) return;
    const def = numbering.find((n) => n.numId === styleNum.numId);
    if (!def) return;

    const level = styleNum.level;
    counters[level] = (counters[level] ?? 0) + 1;
    for (let l = level + 1; l < counters.length; l++) counters[l] = 0;

    const text = formatLevel(def, level, counters);
    if (text) out.set(i, text);
  });
  return out;
}

/** A style's linked numbering, but only when the style is a heading
 *  (its basedOn chain reaches a built-in `HeadingN`). */
function resolveHeadingNumbering(
  styles: readonly NamedStyle[],
  styleId: string | undefined,
): { numId: number; level: number } | undefined {
  let numbering: { numId: number; level: number } | undefined;
  let isHeading = false;
  let id = styleId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = styles.find((x) => x.id === id);
    if (!s) break;
    if (!numbering && s.numbering) numbering = s.numbering;
    if (/^Heading[1-9]$/.test(s.id)) isHeading = true;
    id = s.basedOn;
  }
  return numbering && isHeading ? numbering : undefined;
}

/** Render the level's `lvlText` template (e.g. `%1.%2`), substituting each
 *  `%k` with counter `k-1` formatted in that level's numFmt. */
function formatLevel(def: NumberingDefinition, level: number, counters: readonly number[]): string {
  const lvl = def.abstractFormat.levels[level];
  if (!lvl) return "";
  return lvl.text.replace(/%(\d)/g, (_, k: string) => {
    const idx = Number(k) - 1;
    const fmt = def.abstractFormat.levels[idx]?.format ?? "decimal";
    return formatOrdinal(counters[idx] ?? 0, fmt);
  });
}

/** Format a counter value in an OOXML numbering format (`<w:numFmt>`). */
export function formatOrdinal(n: number, format: string): string {
  switch (format) {
    case "lowerRoman":
      return toRoman(n).toLowerCase();
    case "upperRoman":
      return toRoman(n);
    case "lowerLetter":
      return toLetter(n).toLowerCase();
    case "upperLetter":
      return toLetter(n);
    case "decimalZero":
      return n < 10 ? `0${n}` : String(n);
    default: // decimal, ordinal, cardinalText, … fall back to arabic
      return String(n);
  }
}

const ROMAN: ReadonlyArray<readonly [number, string]> = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

function toRoman(n: number): string {
  if (n <= 0) return String(n);
  let rem = n;
  let out = "";
  for (const [value, sym] of ROMAN) {
    while (rem >= value) {
      out += sym;
      rem -= value;
    }
  }
  return out;
}

/** 1 → A, 26 → Z, 27 → AA (Word's bijective base-26). */
function toLetter(n: number): string {
  if (n <= 0) return String(n);
  let rem = n;
  let out = "";
  while (rem > 0) {
    const r = (rem - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    rem = Math.floor((rem - 1) / 26);
  }
  return out;
}
