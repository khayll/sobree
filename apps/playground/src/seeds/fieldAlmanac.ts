/**
 * Faithful replica of the sobree.dev/try starting document — a THREE-page
 * "Field Almanac": a masthead + conditional-format field key on page 1, a
 * two-column reading section across the page break, and a closing column
 * with a pull-quote and colophon. Kept in sync with
 * `sobree-website/src/lib/try/document.ts` so the playground can exercise
 * the same content (notably: editing inside the two-column section + undo,
 * which round-trips the section's blocks through the column-track layout,
 * and explicit page breaks across sections).
 */
import {
  type SobreeDocument,
  appendBlock,
  emptyDocument,
  namedStyle,
  pageBreak,
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

function keyRow(genus: string, storey: string, reading: string): ReturnType<typeof tableRow> {
  return tableRow([
    tableCell([paragraph([text(genus, { bold: true, fontSizePt: 11, fontFamily: SERIF })])]),
    tableCell([paragraph([text(storey, { fontSizePt: 11, color: MUTED })])]),
    tableCell([paragraph([text(reading, { fontSizePt: 11 })])]),
  ]);
}

function headCell(label: string): ReturnType<typeof tableCell> {
  return tableCell([paragraph([text(label, { bold: true, fontSizePt: 11 })])]);
}

function head(
  label: string,
  fontSizePt: number,
  spacing: { beforeTwips?: number; afterTwips?: number } = {},
): ReturnType<typeof paragraph> {
  return paragraph([text(label, { bold: true, fontSizePt, color: INK, fontFamily: SERIF })], {
    spacing,
  });
}

function body(copy: string, firstLine = true): ReturnType<typeof paragraph> {
  if (!firstLine) {
    return paragraph([text(copy, { fontSizePt: 11.5 })], {
      alignment: "both",
      spacing: { afterTwips: 150 },
    });
  }

  return paragraph([text(copy, { fontSizePt: 11.5 })], {
    alignment: "both",
    indent: { firstLineTwips: 220 },
    spacing: { afterTwips: 150 },
  });
}

function page(): ReturnType<typeof paragraph> {
  return paragraph([pageBreak()], { spacing: { afterTwips: 0 } });
}

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
      {
        spacing: { afterTwips: 60 },
      },
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
      {
        spacing: { afterTwips: 220 },
      },
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
  appendBlock(doc, head("A field key", 18, { beforeTwips: 140, afterTwips: 120 }));
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

  appendBlock(doc, page());
  appendBlock(doc, sectionBreak(1));
  appendBlock(doc, head("What the key means", 18, { afterTwips: 110 }));
  appendBlock(
    doc,
    body(
      "Cirrus clouds sit in the high storey, where the air is cold enough for ice crystals. Their fibres look brushed or combed because strong upper winds pull the crystals into streaks. A sky full of cirrus is often calm at ground level, but it can mark the first distant edge of a changing system.",
      false,
    ),
  );
  appendBlock(
    doc,
    body(
      "Altostratus belongs to the middle storey. It spreads as a grey or blue-grey sheet that weakens the sun until it looks like a pale coin behind glass. When that sheet thickens and lowers, the atmosphere is usually moistening through a deep layer, which is why the table reads it as rain or snow on the way.",
    ),
  );
  appendBlock(
    doc,
    body(
      "Cumulus is the familiar low, heaped cloud of fair days. Small cotton-like towers mean warm air is rising in pockets and then flattening when it reaches a stable layer. The warning in the table is growth: if the heaps build higher, darken underneath, and begin to join, fair weather is giving way to showers.",
    ),
  );
  appendBlock(
    doc,
    body(
      "Nimbostratus is less dramatic than a thunderhead but often more persistent. It forms a low-to-middle blanket with no sharp edges, turning the whole sky into one dim ceiling. The rain beneath it is usually steady rather than sudden, the kind that soaks paths, gutters, cuffs, and fields for hours.",
    ),
  );
  appendBlock(
    doc,
    body(
      "Cumulonimbus is the towering exception: a cloud that grows through several storeys at once. It begins as cumulus, but keeps climbing until its top spreads into an anvil. That vertical reach is the signal for thunder, hail, downdrafts, and quick changes in wind.",
    ),
  );

  appendBlock(doc, page());
  appendBlock(doc, sectionBreak(2));
  appendBlock(doc, head("Reading the weather", 18, { afterTwips: 110 }));
  appendBlock(
    doc,
    body(
      "The useful habit is not naming every cloud perfectly; it is watching the sequence. High wisps followed by a milky middle sheet and then a lower grey ceiling tell a different story from scattered cumulus that rise after breakfast and fade near sunset. The order of the layers is often more revealing than a single snapshot.",
      false,
    ),
  );
  appendBlock(
    doc,
    body(
      "Shape betrays the mood of the air. Flat, layered cloud means the air is rising slowly and gently. Tall, sharply edged cloud means it is rising quickly. If the base darkens while the top keeps building, the column has found enough moisture and lift to make its own weather.",
    ),
  );
  appendBlock(
    doc,
    body(
      "Motion matters too. Clouds at two storeys moving in different directions hint at wind shear and a changing pattern aloft. Low scud racing beneath a smooth grey sheet can mean the rain-bearing layer is already overhead even if the first drops have not arrived.",
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
        spacing: { beforeTwips: 180, afterTwips: 220 },
      },
    ),
  );
  appendBlock(
    doc,
    paragraph(
      [
        text("An almanac specimen — composed, paginated, and saved as ", {
          fontSizePt: 9,
          color: MUTED,
        }),
        text(".docx", { fontSizePt: 9, color: MUTED, fontFamily: "Consolas" }),
        text(", entirely in the browser.", { fontSizePt: 9, color: MUTED }),
      ],
      { borders: { top: border }, spacing: { beforeTwips: 60 } },
    ),
  );

  return doc;
}
