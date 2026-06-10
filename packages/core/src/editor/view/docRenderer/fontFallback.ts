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
  { match: /^helvetica neue$/i, chain: `'Helvetica Neue', Helvetica, Arial, sans-serif` },
  { match: /^verdana$/i, chain: `Verdana, Geneva, Tahoma, sans-serif` },
];

/**
 * Face-name weight / style suffix tokens, PostScript-naming style.
 * Word's `<w:rFonts>` frequently carries a FACE name ("Helvetica Neue
 * Light", "Helvetica Neue Medium") rather than a family. CSS font
 * matching in browsers generally can't resolve those as families (Chrome
 * resolves "Helvetica Neue" but not "Helvetica Neue Light"), so the name
 * must decompose into family + `font-weight` — exactly how Word itself
 * resolves the face internally.
 */
const FACE_TOKENS: Array<{ match: RegExp; weight?: number; italic?: boolean }> = [
  { match: /^(thin|hairline)$/i, weight: 100 },
  { match: /^(extralight|extra light|ultralight|ultra light)$/i, weight: 200 },
  { match: /^light$/i, weight: 300 },
  { match: /^(regular|book|roman)$/i, weight: 400 },
  { match: /^medium$/i, weight: 500 },
  { match: /^(semibold|semi bold|demibold|demi bold)$/i, weight: 600 },
  { match: /^bold$/i, weight: 700 },
  { match: /^(extrabold|extra bold|ultrabold|ultra bold)$/i, weight: 800 },
  { match: /^(black|heavy)$/i, weight: 900 },
  { match: /^(italic|oblique)$/i, italic: true },
];

/** A face name resolved for CSS: the family fallback stack, plus the
 *  weight / italic the face name implied (absent when the name carried
 *  no face tokens — the run's own bold/italic then fully decide). */
export interface ResolvedFontFace {
  stack: string;
  weight?: number;
  italic?: boolean;
}

/**
 * Resolve an OOXML font NAME into a CSS family stack + implied weight.
 *
 * Curated whole-name chains win first ("Calibri Light" is a real family
 * with its own calibrated chain — corpus baselines depend on it). Then
 * trailing face tokens are stripped ("Helvetica Neue Light" → base
 * "Helvetica Neue" + weight 300) and the BASE resolves through the same
 * curated chains; the full face name stays first in the stack so hosts
 * that do ship the exact face still use it. A name with no tokens and no
 * curated chain keeps the documented unknown-font default (`, serif`).
 */
export function resolveFontFace(fontFamily: string): ResolvedFontFace {
  const trimmed = fontFamily.trim();
  if (trimmed.length === 0) return { stack: trimmed };
  for (const { match, chain } of CHAINS) {
    if (match.test(trimmed)) return { stack: chain };
  }

  // Strip trailing face tokens (rightmost first: "Light Italic" → italic,
  // then light). Stop at the first word that isn't a token.
  const words = trimmed.split(/\s+/);
  let weight: number | undefined;
  let italic: boolean | undefined;
  while (words.length > 1) {
    const last = words[words.length - 1]!;
    const token = FACE_TOKENS.find((t) => t.match.test(last));
    if (!token) break;
    if (token.weight !== undefined && weight === undefined) weight = token.weight;
    if (token.italic) italic = true;
    words.pop();
  }

  const base = words.join(" ");
  if (base !== trimmed) {
    const baseChain = CHAINS.find(({ match }) => match.test(base))?.chain;
    const full = needsQuoting(trimmed) ? `'${trimmed}'` : trimmed;
    const stack = baseChain
      ? `${full}, ${baseChain}`
      : `${full}, ${needsQuoting(base) ? `'${base}'` : base}, serif`;
    return {
      stack,
      ...(weight !== undefined ? { weight } : {}),
      ...(italic ? { italic } : {}),
    };
  }

  const quoted = needsQuoting(trimmed) ? `'${trimmed}'` : trimmed;
  return { stack: `${quoted}, serif` };
}

function needsQuoting(name: string): boolean {
  return /[\s"',()]/.test(name);
}
