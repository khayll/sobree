---
title: Document model
description: The OOXML-flavoured AST Sobree edits, exports, and round-trips.
---

Sobree's document model maps 1:1 to OOXML. The names are JS-friendly
(`Paragraph`, `RunProperties`) instead of `<w:p>` / `<w:rPr>` directly,
but the shapes line up — serialisation to `.docx` is mechanical, not
lossy.

## Top level

```ts
interface SobreeDocument {
  body: Block[];                              // top-level content
  sections: SectionProperties[];              // page setup per section
  headerFooterBodies: Record<string, Block[]>;
  headerFooterFrames?: Record<string, AnchoredFrame[]>; // floating drawings inside a header/footer part
  styles: NamedStyle[];
  numbering: NumberingDefinition[];
  rawParts: Record<string, Uint8Array>;       // images, fonts, etc.
  anchoredFrames?: AnchoredFrame[];           // floating drawings in the body (see below)
}
```

## Blocks

`Block = Paragraph | Table | SectionBreak | InlineFrame`. Section breaks
delimit sections; the `sections[i]` index that follows depends on how
many breaks have been seen.

- **Paragraph** — a run sequence (`runs: InlineRun[]`) plus
  `ParagraphProperties` (alignment, spacing, indentation, list info,
  borders). The workhorse block.
- **Table** — `rows → cells → blocks`; cells hold their own `Block[]`,
  so tables nest arbitrarily.
- **SectionBreak** — a structural boundary that advances the active
  `SectionProperties` (see [Sections](#sections)).
- **InlineFrame** — a `<w:drawing><wp:inline>` group that flows in body
  order: a textbox body (recursive `Block[]`) plus decorative pictures /
  shapes, positioned from the group's own coordinate system. This is how
  framed section headings render.
- **AnchoredFrame** — a `<wp:anchor>` floating drawing, kept in the
  document-level `anchoredFrames` array (not in `Block`) because it's
  absolutely positioned rather than in-flow. Wrapping textboxes that
  carry real prose are converted to in-flow blocks on import so they
  paginate; decorations (watermarks, `wrapNone` floats) stay anchored.
  A header/footer part is its own sub-document: its floating drawings
  live in `headerFooterFrames[partId]` (same key as its flow blocks in
  `headerFooterBodies`) and render into a per-zone overlay.

## Runs

A paragraph's content is a list of inline runs:

```ts
type InlineRun =
  | TextRun        // styled text — carries RunProperties (below)
  | BreakRun       // line / column / page break
  | TabRun         // tab stop
  | FieldRun       // page number, NUMPAGES, etc.
  | DrawingRun     // inline or anchored image (placement: "inline" | "anchor")
  | HyperlinkRun   // link wrapping child runs
  | FootnoteRefRun // footnote reference mark
  | CommentRefRun; // comment-range marker
```

`DrawingRun` carries a rendered size (`widthEmu` × `heightEmu`) and a
`placement` — `"inline"` flows like a tall character, `"anchor"` carries
absolute positioning. Each non-text run counts as offset length 1 when
addressing a position (see [InlinePosition](/concepts/editing-model/#inlineposition)).

## Run properties

Every text run carries a `RunProperties` bag that mirrors `<w:rPr>`:

```ts
interface RunProperties {
  bold?: boolean;
  italic?: boolean;
  underline?: "single" | "double" | "dotted" | "dashed" | "wave" | "none";
  strike?: boolean;
  color?: string;          // #rrggbb
  highlight?: string;      // word highlight name OR #rrggbb
  fontFamily?: string;
  fontSizePt?: number;
  verticalAlign?: "subscript" | "superscript";
  // …caps, smallCaps, hidden, shading, …
}
```

Optional fields use `?:` — absence means "not set", not "default". Defaults
are applied at render time from the document's styles.

## Units

Native OOXML units are kept in their native form, with the unit suffixed
in the field name. No silent conversion:

| field           | unit                                               |
|-----------------|----------------------------------------------------|
| `*Twips`        | twentieths of a point (1/1440")                    |
| `*HalfPt`       | half-points (font sizes in OOXML, exposed as pt)   |
| `*Emu`          | English Metric Units (914400 per inch)             |
| `*EighthsOfPt`  | border widths                                      |

Helpers convert to / from CSS-friendly mm where the renderer needs them.

## Sections

Section properties — page size, margins, headers, vAlign, type — apply to
a contiguous slice of the body. `sections.length === sectionBreakCount + 1`.

```ts
interface SectionProperties {
  pageSize: { wTwips, hTwips, orientation };
  pageMargins: { topTwips, rightTwips, bottomTwips, leftTwips, ... };
  headerRefs: HeaderFooterRef[];
  footerRefs: HeaderFooterRef[];
  titlePage?: boolean;
  type?: "continuous" | "nextPage" | "evenPage" | "oddPage";
  vAlign?: "top" | "center" | "bottom" | "both";
}
```

A title-page section is just a section with `titlePage: true`,
`vAlign: "center"`, and a `nextPage` break at its end.

## Building documents in code

Use the builders rather than constructing literals — they apply sensible
defaults and migrate when the schema evolves.

```ts
import {
  emptyDocument, appendBlock,
  paragraph, heading, text, softBreak, pageBreak,
} from "@sobree/core";

const doc = emptyDocument();
appendBlock(doc, heading(1, [text("Title")]));
appendBlock(doc, paragraph([
  text("Welcome to "),
  text("Sobree", { bold: true }),
  text("."),
]));
```

Full set: `paragraph`, `heading`, `text`, `emphasis`, `strong`, `softBreak`,
`pageBreak`, plus `defaultSection`, `defaultPageSize`, `defaultMargins`,
`defaultStyles` for section construction.

## JSON-clean

Every node is plain data — no functions, no class instances, no DOM
references, no `Date` objects. That means a `SobreeDocument` survives
`JSON.stringify` / `JSON.parse` without loss, and crosses any wire
(WebSocket, postMessage, MCP) untouched.

## Round-trip with `.docx`

If you have a mounted editor (via [`createSobree()`](/api/create-sobree/)),
the simplest path is the handle's shortcuts:

```ts
await editor.loadDocx(file);
// …edit…
const { blob } = editor.toDocx();
```

For headless / Worker / server-side pipelines, the underlying functions
are pure and DOM-free:

```ts
import { importDocx, exportDocx } from "@sobree/core";

const { document: doc, warnings } = await importDocx(bytes);
// …edit doc…
const { blob } = exportDocx(doc);
```

`importDocx` accepts `File | Blob | ArrayBuffer | Uint8Array`. `exportDocx`
returns `{ blob, bytes, warnings }`. Round-trip is byte-stable for
paragraphs the editor didn't touch.
