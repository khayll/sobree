import type {
  NamedStyle,
  ParagraphProperties,
  RunProperties,
  SobreeDocument,
} from "./types";

/**
 * Style-cascade resolver — walks `styleId` up its `basedOn` chain and
 * merges defaults base-first, leaf-last. The result is what the
 * renderer should apply (block element inherits these to its runs)
 * and what the toolbar's font / mark dropdowns should reflect.
 *
 * Falls back to the document's `Normal` style at the end of the chain
 * so a paragraph with no explicit style still picks up the document's
 * baseline run / paragraph defaults (see `defaultStyles()` in
 * `./builders`).
 *
 * Cycles in `basedOn` are tolerated — we de-dupe by id and stop
 * walking. Missing styles are silently skipped.
 */
export function resolveStyleCascade(
  styles: readonly NamedStyle[] | SobreeDocument,
  styleId: string | undefined,
): { runDefaults: RunProperties; paragraphDefaults: ParagraphProperties } {
  const list = Array.isArray(styles)
    ? (styles as readonly NamedStyle[])
    : (styles as SobreeDocument).styles;
  const chain = collectStyleChain(list, styleId);
  // Build base-up: deeper inherited defaults first, the block's own
  // style last so it wins on conflict.
  //
  // Sub-objects (spacing, indent, borders) shallow-merge field-by-field
  // — OOXML's cascade is field-level, not object-level. A child style
  // that sets only `spacing.line` MUST keep its parent's `spacing.after`
  // / `spacing.before` / `lineRule`; without this Word's "BodyText
  // overrides line=360 but inherits after=160 from Normal" looks tight
  // and uniform paragraphs in Word land tighter in Sobree.
  let runDefaults: RunProperties = {};
  let paragraphDefaults: ParagraphProperties = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    const s = chain[i]!;
    if (s.runDefaults) runDefaults = { ...runDefaults, ...s.runDefaults };
    if (s.paragraphDefaults) {
      paragraphDefaults = mergeParagraphDefaults(paragraphDefaults, s.paragraphDefaults);
    }
  }
  return { runDefaults, paragraphDefaults };
}

function mergeParagraphDefaults(
  base: ParagraphProperties,
  over: ParagraphProperties,
): ParagraphProperties {
  return {
    ...base,
    ...over,
    spacing: { ...base.spacing, ...over.spacing },
    indent: { ...base.indent, ...over.indent },
    borders: { ...base.borders, ...over.borders },
  };
}

function collectStyleChain(
  styles: readonly NamedStyle[],
  styleId: string | undefined,
): NamedStyle[] {
  const out: NamedStyle[] = [];
  const seen = new Set<string>();
  let id = styleId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = styles.find((x) => x.id === id);
    if (!s) break;
    out.push(s);
    id = s.basedOn;
  }
  // Always anchor the chain in the document's "Normal" style so a
  // paragraph with no explicit styleId still picks up document
  // baseline defaults (DocDefaults' spacing.afterTwips etc.). The
  // style id varies by language: "Normal" (English), "Norml"
  // (Hungarian, accent-stripped), "Standard" (German), "Estilo Normal"
  // (Spanish), ... — Word stamps `displayName="Normal"` on whichever
  // style serves the role. Find by that first, then fall back to the
  // literal "Normal" id, then to whatever style is basedOn DocDefaults
  // (Word's other convention for marking the anchor).
  const normal = findNormalAnchor(styles);
  // Continue the cascade walk from the Normal anchor through its
  // basedOn chain (typically to DocDefaults). Without continuing the
  // walk, paragraphs with no explicit style would skip DocDefaults
  // entirely and lose every doc-level default — including the
  // post-paragraph spacing that creates Word's characteristic
  // breathing room between every paragraph.
  let anchorId: string | undefined = normal?.id;
  while (anchorId && !seen.has(anchorId)) {
    seen.add(anchorId);
    const s = styles.find((x) => x.id === anchorId);
    if (!s) break;
    out.push(s);
    anchorId = s.basedOn;
  }
  return out;
}

function findNormalAnchor(styles: readonly NamedStyle[]): NamedStyle | undefined {
  // 1. Literal id match (English Word, most common).
  const byId = styles.find((s) => s.id === "Normal");
  if (byId) return byId;
  // 2. displayName = "Normal" (localized id, Word stamps the canonical
  //    English display name).
  const byDisplay = styles.find(
    (s) => s.type === "paragraph" && s.displayName === "Normal",
  );
  if (byDisplay) return byDisplay;
  // 3. Paragraph style based directly on DocDefaults (Word's other
  //    anchor convention — the "Normal" style is the first one based
  //    on DocDefaults).
  const byBase = styles.find(
    (s) => s.type === "paragraph" && s.basedOn === "DocDefaults",
  );
  return byBase;
}
