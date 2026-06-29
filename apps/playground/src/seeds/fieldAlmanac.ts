/**
 * Faithful replica of the sobree.dev/try starting document — a THREE-page
 * "Field Almanac" paginated with `nextPage` section breaks: a single-column
 * cover (masthead, lede, table of contents), a two-column body that snakes
 * across the columns, and a full-width reference page (the conditional-format
 * field key, weather sayings, a pull-quote, and a colophon). Kept in sync
 * with `sobree-website/src/lib/try/document.ts` so the playground exercises
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

// Palette — a warm amber accent over near-black ink, with a soft amber
// band and a light warm gridline.
const ACCENT = "#F2A900";
const INK = "#1F1B16";
const MUTED = "#6B6256";
const BAND = "#FCF3DD";
const LINE = "#E7E2D8";
// A single family name (not a CSS stack) — the renderer quotes the value as
// one OOXML font name, so a comma-separated fallback list would break.
const SERIF = "Georgia";

const border = { style: "single" as const, sizeEighthsOfPt: 4, color: LINE };

/** One row of the field key: genus, the storey it sits in, and the plain
 *  reading. The first cell is set in the display serif for emphasis. */
function keyRow(genus: string, storey: string, reading: string): ReturnType<typeof tableRow> {
  return tableRow([
    tableCell([paragraph([text(genus, { bold: true, fontSizePt: 11, fontFamily: SERIF })])]),
    tableCell([paragraph([text(storey, { fontSizePt: 11, color: MUTED })])]),
    tableCell([paragraph([text(reading, { fontSizePt: 11 })])]),
  ]);
}

/** A header cell for the field key — bold, on the accent fill. */
function headCell(label: string): ReturnType<typeof tableCell> {
  return tableCell([paragraph([text(label, { bold: true, fontSizePt: 11 })])]);
}

/** Display heading in the editorial serif. Built as a styled paragraph
 *  rather than `heading()` so the serif face actually wins — a Heading named
 *  style's own font would otherwise override the run's. */
function head(
  label: string,
  fontSizePt: number,
  spacing: { beforeTwips?: number; afterTwips?: number } = {},
): ReturnType<typeof paragraph> {
  return paragraph([text(label, { bold: true, fontSizePt, color: INK, fontFamily: SERIF })], {
    spacing,
    keepNext: true, // a heading travels with the paragraph that follows it
  });
}

/** A justified body paragraph in the running text style. */
function body(
  runs: ReturnType<typeof text>[],
  spacing: { beforeTwips?: number; afterTwips?: number } = { afterTwips: 140 },
  indentFirstLine = false,
): ReturnType<typeof paragraph> {
  return paragraph(runs, {
    alignment: "both",
    spacing,
    ...(indentFirstLine ? { indent: { firstLineTwips: 220 } } : {}),
  });
}

/** A line in the cover's table of contents: a serif accent numeral, the
 *  section title, and a muted gloss. */
function tocLine(numeral: string, title: string, gloss: string): ReturnType<typeof paragraph> {
  return paragraph(
    [
      text(`${numeral}  `, { bold: true, fontSizePt: 13, color: ACCENT, fontFamily: SERIF }),
      text(title, { bold: true, fontSizePt: 12, fontFamily: SERIF }),
      text(`   — ${gloss}`, { italic: true, fontSizePt: 11, color: MUTED }),
    ],
    { spacing: { afterTwips: 90 } },
  );
}

/** The accent-rule pull quote used to close the almanac. */
function pullQuote(
  quote: string,
  spacing: { beforeTwips?: number; afterTwips?: number },
): ReturnType<typeof paragraph> {
  return paragraph(
    [text(quote, { italic: true, fontSizePt: 14, color: ACCENT, fontFamily: SERIF })],
    {
      borders: { left: { style: "single", sizeEighthsOfPt: 24, color: ACCENT } },
      indent: { leftTwips: 200 },
      spacing,
    },
  );
}

export function fieldAlmanacSeed(): SobreeDocument {
  const doc = emptyDocument();
  doc.body = []; // drop the starter paragraph — we build our own blocks

  // Three sections, each forced onto its own page with a nextPage break:
  // a single-column cover, a two-column body that snakes across the
  // columns, and a full-width reference page (the key + colophon).
  const base = doc.sections[0]!;
  doc.sections = [
    // Cover: centre the title block vertically so the short page reads as a
    // composed title page instead of content stacked at the top.
    { ...base, vAlign: "center" },
    { ...base, type: "nextPage", columns: { count: 2, spaceTwips: 520, separator: true } },
    { ...base, type: "nextPage" },
  ];

  // A table style that paints an amber header row + banded body rows over
  // thin interior gridlines — resolved per cell at render time.
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

  // ══ PAGE 1 — Section 0 — cover / masthead ═══════════════════════════
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
  appendBlock(doc, head("Reading the Sky", 34, { afterTwips: 80 }));
  appendBlock(
    doc,
    paragraph(
      [
        text("How to tell, at a glance upward, what the next few hours intend.", {
          italic: true,
          fontSizePt: 14,
          color: MUTED,
          fontFamily: SERIF,
        }),
      ],
      { spacing: { afterTwips: 260 } },
    ),
  );
  appendBlock(
    doc,
    body(
      [
        text("High overhead, ", { bold: true, smallCaps: true }),
        text(
          "the air keeps an honest diary. Long before a forecast reaches a screen, the clouds have already drafted it — in their shape, in the storey they occupy, and in the speed they cross the sun. Learn their handful of names and the sky becomes a page you can read.",
        ),
      ],
      { afterTwips: 160 },
    ),
  );
  appendBlock(
    doc,
    body(
      [
        text(
          "This almanac is a single specimen — composed, paginated, and exported as a Word file, entirely in the browser. What follows is the whole of it: the three storeys clouds occupy, how their shapes betray the weather, and a field key you can hold up against any sky.",
        ),
      ],
      { afterTwips: 300 },
    ),
  );
  appendBlock(
    doc,
    paragraph(
      [text("In this almanac", { bold: true, smallCaps: true, fontSizePt: 11, color: ACCENT })],
      { borders: { bottom: border }, spacing: { afterTwips: 140 } },
    ),
  );
  appendBlock(doc, tocLine("I", "The three storeys", "sorting cloud by the floor it occupies"));
  appendBlock(doc, tocLine("II", "Reading the weather", "what shape and motion give away"));
  appendBlock(doc, tocLine("III", "A field key", "five genera, and what each one tells you"));

  // ══ PAGE 2 — Section 1 — two-column body ════════════════════════════
  appendBlock(doc, sectionBreak(1));
  appendBlock(doc, head("The three storeys", 15, { afterTwips: 90 }));
  appendBlock(
    doc,
    body([
      text(
        "Meteorologists sort clouds the way a builder sorts floors — by the storey they occupy. Each deck has its own air, its own temperature, and its own cast of cloud, and naming the floor is half of naming the cloud.",
      ),
    ]),
  );
  appendBlock(
    doc,
    body([
      text(
        "Height decides almost everything else. The higher the cloud, the colder the air it forms in, and the more of it is ice rather than water — which in turn settles whether it drifts, drizzles, or pours. Fix the storey first and the name very nearly follows; miss it, and two clouds alike from the ground can mean opposite afternoons.",
      ),
    ]),
  );
  appendBlock(doc, head("The high deck", 12, { beforeTwips: 60, afterTwips: 70 }));
  appendBlock(
    doc,
    body([
      text(
        "Above roughly six kilometres the air is bitterly cold, and every cloud there is made of ice. These are the cirrus clouds — thin, fibrous, drawn out by the wind into the long streaks sailors called mares' tails. They are too sheer to shadow the ground, but a sky that fills with them is rarely idle for long.",
      ),
    ]),
  );
  appendBlock(doc, head("The middle storey", 12, { beforeTwips: 60, afterTwips: 70 }));
  appendBlock(
    doc,
    body([
      text(
        "Between two and six kilometres live the alto- clouds: sheets and rolls of mixed ice and water that soften the sun to a pale coin behind frosted glass. When altostratus spreads and thickens, it is often the middle act of a front — the overture to the lower, wetter cloud still to come.",
      ),
    ]),
  );
  appendBlock(doc, head("The low clouds", 12, { beforeTwips: 60, afterTwips: 70 }));
  appendBlock(
    doc,
    body([
      text(
        "Nearest the ground sit the clouds we meet most often: heaped white cumulus drifting on a fair afternoon, flat grey stratus pressing the hills, and the bruised, towering cumulonimbus that carries thunder. These are near enough to cast a shadow you can stand in, and to soak you within the hour.",
      ),
    ]),
  );
  appendBlock(doc, head("Reading the weather", 15, { beforeTwips: 120, afterTwips: 90 }));
  appendBlock(
    doc,
    body(
      [
        text(
          "Shape betrays the mood of the air. Flat, layered cloud means it is rising slowly and gently; tall, cauliflower heads mean it is climbing fast — and may keep climbing until it towers into a storm. A sky that thickens and lowers through the day, from wisps to a uniform grey, is the classic signature of an approaching front, and usually of rain by evening.",
        ),
      ],
      { afterTwips: 140 },
      true,
    ),
  );
  appendBlock(
    doc,
    body(
      [
        text(
          "Motion matters as much as form. Cloud crossing quickly while the wind at your back blows from a different quarter is an old, reliable sign of weather on the turn within a day. Watch the direction the highest clouds travel, not the lowest — the upper winds arrive first, and they bring the news.",
        ),
      ],
      { afterTwips: 140 },
      true,
    ),
  );
  appendBlock(doc, head("Signs in the wind", 12, { beforeTwips: 60, afterTwips: 70 }));
  appendBlock(
    doc,
    body([
      text(
        "Stand with your back to the wind and, in the northern hemisphere, low pressure lies to your left — Buys Ballot's law, and the reason a backing wind so often runs ahead of rain. A steady breeze that swings anticlockwise through the day is the front announcing itself hours before the first cloud thickens overhead.",
      ),
    ]),
  );
  appendBlock(
    doc,
    body([
      text(
        "Smell and sound carry the same news. Air grows heavy and earthy before rain as falling pressure lets the ground breathe out; distant noise sharpens as a damp, settling sky bends it back down. Neither is superstition — both are the lower air thickening, the very change the clouds above are drawing in shorthand.",
      ),
    ]),
  );
  appendBlock(doc, head("The colour of the light", 12, { beforeTwips: 60, afterTwips: 70 }));
  appendBlock(
    doc,
    body(
      [
        text(
          "Colour is the last tell. A hard, glassy blue means dry air and fair hours ahead; a milky, whitening sky is high ice moving in, the front's first scout. Save the reddest skies for dawn and dusk, when the low sun must travel furthest through the air — and read them, as every shepherd has, by which way the weather is already going.",
        ),
      ],
      { afterTwips: 0 },
      true,
    ),
  );

  // ══ PAGE 3 — Section 2 — full-width field key + colophon ═════════════
  appendBlock(doc, sectionBreak(2));
  appendBlock(doc, head("A field key", 20, { afterTwips: 70 }));
  appendBlock(
    doc,
    paragraph(
      [
        text(
          "Five genera carry most of what a sky can say. Match what is overhead against the rows below, read across, and you have your forecast.",
          { italic: true, fontSizePt: 12, color: MUTED, fontFamily: SERIF },
        ),
      ],
      { spacing: { afterTwips: 150 } },
    ),
  );
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
  appendBlock(doc, head("Old saws worth keeping", 15, { beforeTwips: 220, afterTwips: 90 }));
  appendBlock(
    doc,
    body([
      text("Red sky at night, ", { smallCaps: true }),
      text(
        "shepherd's delight — a clear western horizon at dusk lets the low sun redden, a sign the weather is passing east and away. The same red at morning warns the clear air has already gone by, and the front is moving in behind it.",
      ),
    ]),
  );
  appendBlock(
    doc,
    body(
      [
        text("Halo round the moon, ", { smallCaps: true }),
        text(
          "rain or snow soon — a ring of light is sunlight bent through high cirrus ice, and high ice is often the first edge of an approaching system. Count it as a day's warning, no more.",
        ),
      ],
      { afterTwips: 60 },
    ),
  );
  appendBlock(
    doc,
    pullQuote("Forecasts expire. A sky, read well, never does.", {
      beforeTwips: 200,
      afterTwips: 220,
    }),
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
