/**
 * Build a CSS `font-family` value with metric-compatible fallbacks.
 *
 * Why: when a docx specifies `font-family: "Bookman Old Style"` and
 * the host machine doesn't have it installed, the browser picks an
 * arbitrary system serif. The fallback may have a much taller natural
 * ascender+descender than the requested font — and CSS's line-box
 * height = `max(line-height, font-strut-height)`, so the line box
 * inflates beyond the declared `line-height`. That cumulative inflation
 * shifts pagination decisions (a single docx ends up taking more pages
 * than Word produces).
 *
 * The fix: emit a fallback chain whose members have metrics close to
 * the primary font. Georgia is metrically near Bookman; Helvetica Neue
 * near Calibri; etc. The chain ends in a generic family so we never
 * fall off the cliff into the browser's last-resort serif/sans pick.
 *
 * Diagnosis trail: per-block height inflation surfaced via
 * `pnpm fixtures:compare --pages` on user-contract.docx (Bookman not
 * installed on macOS by default). See [diagnosis notes].
 */

/** Hand-curated fallback chains. Each entry's first member is the
 *  primary font; the chain ends in a generic family. Keys are matched
 *  case-insensitively against the primary font's name.
 *
 *  Multi-word names are wrapped in *single* quotes (CSS accepts either)
 *  so the inline-style string can later be embedded in JSON / snapshot
 *  files using double-quotes without needing escapes. */
const CHAINS: Array<{ match: RegExp; chain: string }> = [
  // Calibri & relatives — modern sans-serif.
  //
  // Carlito is Google's open-source, metric-compatible clone of
  // Calibri (Google Fonts SIL OFL). Linux distros + LibreOffice
  // bundle it, and it's the only fallback whose U+2026 (…) glyph
  // matches Calibri's narrow width. Without Carlito the chain
  // falls through to Helvetica/Arial, whose ellipsis glyphs are
  // ~2× wider — long dot-leader runs in CV templates ("……………")
  // then overflow the line. Carlito sits BEFORE Helvetica Neue so
  // any host with Carlito installed gets Word-fidelity rendering.
  { match: /^calibri light$/i, chain: `'Calibri Light', Carlito, 'Helvetica Neue', 'Helvetica Light', Helvetica, Arial, sans-serif` },
  { match: /^calibri$/i, chain: `Calibri, Carlito, 'Helvetica Neue', Helvetica, Arial, sans-serif` },
  // Serif families. Chain ends at Times for missing-font fallback
  // because Word and LibreOffice both substitute unknown serif fonts
  // with Times by default — putting Georgia or Hoefler ahead would
  // give visually different rendering than the user's Word, even
  // though Georgia is metrically closer to Bookman. Documents look
  // the same in Sobree and Word when the requested font is missing.
  { match: /^bookman old style$/i, chain: `'Bookman Old Style', Bookman, 'URW Bookman L', 'Times New Roman', serif` },
  { match: /^cambria$/i, chain: `Cambria, 'Times New Roman', serif` },
  { match: /^times new roman$/i, chain: `'Times New Roman', Times, serif` },
  { match: /^georgia$/i, chain: `Georgia, 'Times New Roman', serif` },
  // Common sans-serif neighbours.
  { match: /^arial$/i, chain: `Arial, 'Helvetica Neue', Helvetica, sans-serif` },
  { match: /^helvetica$/i, chain: `Helvetica, 'Helvetica Neue', Arial, sans-serif` },
  { match: /^verdana$/i, chain: `Verdana, Geneva, Tahoma, sans-serif` },
];

/**
 * Wrap `fontFamily` in quotes if it contains spaces or unusual
 * characters, and append a metric-compatible fallback chain. If the
 * font already matches a curated entry, use that chain directly so the
 * primary font isn't double-listed.
 */
export function withFallbacks(fontFamily: string): string {
  const trimmed = fontFamily.trim();
  if (trimmed.length === 0) return trimmed;
  for (const { match, chain } of CHAINS) {
    if (match.test(trimmed)) return chain;
  }
  // Unknown font — quote if needed and end in a generic family. We
  // can't know whether the font is serif or sans-serif without
  // metadata; default to `serif` since most uncommon docx fonts are
  // serif (legal/contract templates lean that way).
  const quoted = needsQuoting(trimmed) ? `'${trimmed}'` : trimmed;
  return `${quoted}, serif`;
}

function needsQuoting(name: string): boolean {
  return /[\s"',()]/.test(name);
}
