/**
 * Faithful replica of the sobree.dev/try starting document — a one-page
 * "Field Almanac" with a masthead, a TWO-COLUMN snaking body section, and
 * a full-width conditional-format table + colophon. Kept in sync with
 * `sobree-website/src/lib/try/document.ts` so the playground can exercise
 * the same content (notably: editing inside the two-column section + undo,
 * which round-trips the section's blocks through the column-track layout).
 */
import {
  type SobreeDocument,
  appendBlock,
  emptyDocument,
  namedStyle,
  paragraph,
  sectionBreak,
  table,
  tableCell,
  tableRow,
  text,
} from "@sobree/core";

const ACCENT = "#F2A900";
const INK = "#1F1B16";
const MUTED = "#6B6256";
const BAND = "#FCF3DD";
const LINE = "#E7E2D8";
const SERIF = "Georgia";
const border = { style: "single" as const, sizeEighthsOfPt: 4, color: LINE };

const head = (
  label: string,
  fontSizePt: number,
  spacing: { beforeTwips?: number; afterTwips?: number } = {},
) =>
  paragraph([text(label, { bold: true, fontSizePt, color: INK, fontFamily: SERIF })], { spacing });

const headCell = (label: string) =>
  tableCell([paragraph([text(label, { bold: true, fontSizePt: 11 })])]);

const keyRow = (genus: string, storey: string, reading: string) =>
  tableRow([
    tableCell([paragraph([text(genus, { bold: true, fontSizePt: 11, fontFamily: SERIF })])]),
    tableCell([paragraph([text(storey, { fontSizePt: 11, color: MUTED })])]),
    tableCell([paragraph([text(reading, { fontSizePt: 11 })])]),
  ]);

export function fieldAlmanacSeed(): SobreeDocument {
  const doc = emptyDocument();
  doc.body = [];
  const base = doc.sections[0]!;
  doc.sections = [
    base,
    { ...base, type: "continuous", columns: { count: 2, spaceTwips: 520 } },
    { ...base, type: "continuous" },
  ];
  doc.styles.push(
    namedStyle("FieldKey", {
      type: "table",
      displayName: "Field Key",
      tableStyle: {
        borders: { insideH: border, insideV: border },
        conditional: {
          firstRow: { shading: { pattern: "clear", fill: ACCENT } },
          band2Horz: { shading: { pattern: "clear", fill: BAND } },
        },
      },
    }),
  );

  // Section 0 — masthead
  appendBlock(
    doc,
    paragraph(
      [
        text("Field Almanac · The Sky", {
          bold: true,
          smallCaps: true,
          fontSizePt: 11,
          color: ACCENT,
        }),
      ],
      { spacing: { afterTwips: 60 } },
    ),
  );
  appendBlock(doc, head("Reading the Sky", 30, { afterTwips: 80 }));
  appendBlock(
    doc,
    paragraph(
      [
        text("How to tell, at a glance upward, what the next few hours intend.", {
          italic: true,
          fontSizePt: 13,
          color: MUTED,
          fontFamily: SERIF,
        }),
      ],
      { spacing: { afterTwips: 220 } },
    ),
  );
  appendBlock(
    doc,
    paragraph(
      [
        text("High overhead, ", { bold: true, smallCaps: true }),
        text(
          "the air keeps an honest diary. Long before a forecast reaches a screen, the clouds have already drafted it — in their shape, in the storey they occupy, and in the speed they cross the sun. Learn their handful of names and the sky becomes a page you can read.",
        ),
      ],
      { alignment: "both", spacing: { afterTwips: 160 } },
    ),
  );

  // Section 1 — two-column body
  appendBlock(doc, sectionBreak(1));
  appendBlock(doc, head("The three storeys", 14, { afterTwips: 80 }));
  appendBlock(
    doc,
    paragraph(
      [
        text(
          "Meteorologists sort clouds the way a builder sorts floors — by the storey they occupy. The high deck, above roughly six kilometres, belongs to ice: thin, fibrous cirrus that the wind combs into mares' tails. The middle storey carries the alto- family, sheets and rolls that soften the sun to a coin. Lowest sit the heaped cumulus and grey stratus we meet most often, near enough to cast a shadow you can stand in.",
        ),
      ],
      { alignment: "both", spacing: { afterTwips: 140 } },
    ),
  );
  appendBlock(doc, head("Reading the weather", 14, { afterTwips: 80 }));
  appendBlock(
    doc,
    paragraph(
      [
        text(
          "Shape betrays the mood of the air. Flat, layered cloud means it is rising slowly and gently; tall, cauliflower heads mean it is climbing fast — and may keep climbing until it towers into a storm. A sky that thickens and lowers through the day, from wisps to a uniform grey, is the classic signature of an approaching front, and usually of rain by evening.",
        ),
      ],
      { alignment: "both", indent: { firstLineTwips: 220 } },
    ),
  );

  // Section 2 — full-width field key + colophon
  appendBlock(doc, sectionBreak(2));
  appendBlock(doc, head("A field key", 18, { beforeTwips: 200, afterTwips: 120 }));
  appendBlock(
    doc,
    table(
      [
        tableRow([headCell("Genus"), headCell("Storey"), headCell("The sky is telling you")], {
          isHeader: true,
        }),
        keyRow("Cirrus", "High", "Fair for now; change within a day"),
        keyRow("Altostratus", "Middle", "Rain or snow on the way"),
        keyRow("Cumulus", "Low", "Fair weather — but watch it grow"),
        keyRow("Nimbostratus", "Low–middle", "Steady, soaking rain"),
        keyRow("Cumulonimbus", "Towering", "Thunder, hail, sudden gusts"),
      ],
      {
        grid: [2280, 2040, 5040],
        properties: {
          styleId: "FieldKey",
          look: { firstRow: true, hBand: true },
          cellMargins: { topTwips: 90, bottomTwips: 90, leftTwips: 130, rightTwips: 130 },
        },
      },
    ),
  );
  appendBlock(
    doc,
    paragraph(
      [
        text("Forecasts expire. A sky, read well, never does.", {
          italic: true,
          fontSizePt: 14,
          color: ACCENT,
          fontFamily: SERIF,
        }),
      ],
      {
        borders: { left: { style: "single", sizeEighthsOfPt: 24, color: ACCENT } },
        indent: { leftTwips: 200 },
        spacing: { beforeTwips: 220, afterTwips: 220 },
      },
    ),
  );
  return doc;
}
