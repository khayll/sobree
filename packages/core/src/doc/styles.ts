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
 * Anchors in `DocDefaults` (the document-wide base) for every style.
 * The `Normal` default-paragraph style is added ONLY for a paragraph
 * with no explicit style — a style that exists but declares no
 * `basedOn` inherits DocDefaults alone, matching OOXML (Normal is
 * threaded in only via an explicit `basedOn`).
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

/**
 * Resolve a RUN character style (`<w:rStyle>`) to the run properties it
 * contributes: its own rPr merged up its `basedOn` chain — but WITHOUT
 * the Normal / DocDefaults anchor that `resolveStyleCascade` appends.
 *
 * A character style layers on top of the run's INHERITED paragraph
 * formatting; folding the document defaults back in here would reset the
 * run's font / size to the doc default (e.g. a colour-only "Blue" char
 * style must not drag Times/12pt onto a Helvetica/10pt contact line). So
 * we walk only the explicit `basedOn` chain and stop — no Normal anchor.
 */
export function resolveRunStyle(
  styles: readonly NamedStyle[],
  styleId: string,
): RunProperties {
  const chain: NamedStyle[] = [];
  const seen = new Set<string>();
  let id: string | undefined = styleId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = styles.find((x) => x.id === id);
    if (!s) break;
    chain.push(s);
    id = s.basedOn;
  }
  // Base-up so the named style itself wins on conflict.
  let out: RunProperties = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    const rd = chain[i]?.runDefaults;
    if (rd) out = { ...out, ...rd };
  }
  return out;
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
  const walk = (from: string | undefined): void => {
    let id = from;
    while (id && !seen.has(id)) {
      seen.add(id);
      const s = styles.find((x) => x.id === id);
      if (!s) break;
      out.push(s);
      id = s.basedOn;
    }
  };

  // 1. Walk the paragraph's own style up its `basedOn` chain.
  walk(styleId);

  // 2. The default paragraph style ("Normal") applies ONLY when the
  //    paragraph references no style (or an unknown one). A style that
  //    DOES exist but declares no `basedOn` inherits from DocDefaults
  //    alone — NOT from Normal: OOXML threads Normal in only via an
  //    explicit `basedOn`. Force-anchoring every style in Normal leaked
  //    its pPr (e.g. `spacing after=120`) onto standalone styles like a
  //    fact-sheet's `StatContext`, over-spacing them vs Word/LO. The
  //    localised id varies ("Norml", "Standard", "Estilo Normal", …) —
  //    `findNormalAnchor` resolves it by role.
  if (out.length === 0) {
    walk(findNormalAnchor(styles)?.id);
  }

  // 3. DocDefaults is the document-wide base and applies to EVERYTHING.
  //    The walks above reach it when a chain threads through Normal; a
  //    standalone style doesn't, so ensure it's present (the importer
  //    synthesises it from `<w:docDefaults>` under this id).
  const docDefaults = styles.find((x) => x.id === "DocDefaults");
  if (docDefaults && !seen.has(docDefaults.id)) out.push(docDefaults);

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
