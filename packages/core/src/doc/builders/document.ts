/**
 * Document- and section-level builders: the scaffolding a document needs
 * before any content goes in (blank doc, default section / page geometry,
 * the standard style set), plus small structural helpers.
 */

import type {
  Block,
  HeaderFooterRef,
  NamedStyle,
  PageMargins,
  PageSize,
  Paragraph,
  SectionProperties,
  SobreeDocument,
  Table,
} from "../types";
import { paragraph } from "./block";

const A4_WIDTH_TWIPS = 11906; // 210 mm
const A4_HEIGHT_TWIPS = 16838; // 297 mm
const ONE_INCH_TWIPS = 1440;
const HALF_INCH_TWIPS = ONE_INCH_TWIPS / 2; // 720 — Word's default header/footer offset
const SINGLE_SPACING_LINE = 240; // `w:line` for 1.0× line spacing (auto rule)
const DEFAULT_FONT_SIZE_PT = 11; // Normal style's default run size

/** A new, blank document with an A4 portrait section and the standard styles. */
export function emptyDocument(): SobreeDocument {
  return {
    body: [paragraph()],
    sections: [defaultSection()],
    headerFooterBodies: {},
    styles: defaultStyles(),
    numbering: [],
    rawParts: {},
    fonts: [],
  };
}

export function defaultSection(): SectionProperties {
  return {
    pageSize: defaultPageSize(),
    pageMargins: defaultMargins(),
    headerRefs: [],
    footerRefs: [],
  };
}

export function defaultPageSize(): PageSize {
  return { wTwips: A4_WIDTH_TWIPS, hTwips: A4_HEIGHT_TWIPS, orientation: "portrait" };
}

export function defaultMargins(): PageMargins {
  return {
    topTwips: ONE_INCH_TWIPS,
    rightTwips: ONE_INCH_TWIPS,
    bottomTwips: ONE_INCH_TWIPS,
    leftTwips: ONE_INCH_TWIPS,
    headerTwips: HALF_INCH_TWIPS,
    footerTwips: HALF_INCH_TWIPS,
    gutterTwips: 0,
  };
}

/** Default Word styles every doc declares so headings render correctly.
 *
 *  Carries WORD-HARDCODED-DEFAULT typography — i.e. what Word uses
 *  when a docx has bare/empty styles.xml entries. That means single
 *  line spacing (1.0×) and zero space-before / space-after on Normal.
 *  Headings keep their bold + size on `runDefaults` but DON'T add
 *  spacing-before/after either — the original docx tells the renderer
 *  via per-paragraph `spacing` properties when something needs to
 *  breathe.
 *
 *  This is the load-bearing constraint: a docx round-trip must not
 *  silently add (or remove) vertical rhythm the original didn't ask
 *  for. Embedders that want a different baseline (e.g. markdown output
 *  with 8pt-after for visible paragraph separation) override the
 *  Normal style on the document they construct — see `parseMarkdown`.
 *
 *  Heading scale steps down from a prominent H1 at 24pt to body-sized
 *  H6 at 11pt. */
export function defaultStyles(): NamedStyle[] {
  const headingSizes = [24, 20, 16, 14, 12, 11] as const;
  const out: NamedStyle[] = [
    {
      id: "Normal",
      type: "paragraph",
      displayName: "Normal",
      runDefaults: {
        fontFamily: "Helvetica",
        fontSizePt: DEFAULT_FONT_SIZE_PT,
      },
      // Word hardcoded default — single line, zero before/after.
      paragraphDefaults: {
        spacing: { line: SINGLE_SPACING_LINE, lineRule: "auto" },
      },
    },
  ];
  for (let i = 1; i <= 6; i++) {
    const size = headingSizes[i - 1] ?? DEFAULT_FONT_SIZE_PT;
    out.push({
      id: `Heading${i}`,
      type: "paragraph",
      displayName: `heading ${i}`,
      basedOn: "Normal",
      nextStyleId: "Normal",
      runDefaults: {
        bold: true,
        fontFamily: "Helvetica",
        fontSizePt: size,
      },
      // No paragraph-level spacing — inherits from Normal (single
      // line). Documents authored in tools that want breathing
      // room around headings ship explicit `spacing.beforeTwips`
      // / `afterTwips` per heading paragraph.
    });
  }
  out.push({
    id: "Quote",
    type: "paragraph",
    displayName: "Quote",
    basedOn: "Normal",
    runDefaults: { italic: true },
    // Quote indent only — no spacing change vs Normal.
    paragraphDefaults: {
      indent: { leftTwips: 567, rightTwips: 567 },
    },
  });
  return out;
}

/** Push a block onto the document body. Mutates `doc` and returns it. */
export function appendBlock(doc: SobreeDocument, block: Block): SobreeDocument {
  doc.body.push(block);
  return doc;
}

/** Allocate a new header/footer reference id. Pure helper. */
export function makeHeaderFooterRef(
  type: "default" | "first" | "even",
  partId: string,
): HeaderFooterRef {
  return { type, partId };
}

export function isParagraph(block: Block): block is Paragraph {
  return block.kind === "paragraph";
}

export function isTable(block: Block): block is Table {
  return block.kind === "table";
}
