/**
 * Generate a curated set of small `.docx` fixtures used by Sobree's
 * rendering-oracle tests.
 *
 * Each fixture exercises ONE OOXML feature so unit failures point at a
 * specific cause. Generated with the `docx` npm package (https://docx.js.org)
 * so we're not testing Sobree against Sobree's own exporter.
 *
 * Workflow for each fixture:
 *
 *   1. `pnpm fixtures:gen` writes the .docx to
 *      `packages/core/src/docx/import/fixtures/`.
 *   2. Open the .docx in Word, screenshot the rendering, drop the
 *      screenshot alongside as `<name>.word.png`.
 *   3. The oracle test imports the .docx, renders in jsdom, asserts
 *      computed styles match a stored `<name>.expected.json` (derived
 *      from the Word screenshot).
 *
 * Adding a new exemplar: write a new builder below + add it to FIXTURES.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  HeightRule,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalMergeType,
  WidthType,
} from "docx";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Corpus root — fixtures land at `<repo>/tests/corpus/generated/<category>/<slug>/source.docx`. */
const CORPUS_ROOT = join(HERE, "..", "..", "..", "tests", "corpus", "generated");

interface Fixture {
  name: string;
  description: string;
  /** Corpus category folder under `tests/corpus/generated/`. Drives where
   *  the docx + companion artifacts (snapshot, baseline, libreoffice
   *  metrics + PNGs) live. */
  category: string;
  build: () => Document;
}

const FIXTURES: Fixture[] = [
  {
    name: "01-hello-world",
    category: "paragraph",
    description: "Single paragraph in the Normal style. Baseline for everything.",
    build: () =>
      new Document({
        sections: [
          {
            properties: {},
            children: [new Paragraph({ children: [new TextRun("Hello, world.")] })],
          },
        ],
      }),
  },

  {
    name: "02-heading-and-body",
    category: "paragraph",
    description:
      "Heading 1 followed by two body paragraphs. Exercises heading style spacing-before/after and font/size from the cascade.",
    build: () =>
      new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                heading: HeadingLevel.HEADING_1,
                children: [new TextRun("Section title")],
              }),
              new Paragraph({
                children: [
                  new TextRun(
                    "First body paragraph after the heading. Should have the heading's after-spacing as a gap above it.",
                  ),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun(
                    "Second body paragraph. Should sit at body line-height with body after-spacing between it and the first.",
                  ),
                ],
              }),
            ],
          },
        ],
      }),
  },

  {
    name: "03-bodytext-line-360",
    category: "paragraph",
    description:
      "Three consecutive paragraphs with explicit <w:spacing w:line='360' w:lineRule='auto'/> (1.5×). Tests per-paragraph line-height override surviving the cascade.",
    build: () =>
      new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                spacing: { line: 360, lineRule: LineRuleType.AUTO },
                children: [
                  new TextRun(
                    "Paragraph one with explicit 1.5× line spacing. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
                  ),
                ],
              }),
              new Paragraph({
                spacing: { line: 360, lineRule: LineRuleType.AUTO },
                children: [
                  new TextRun(
                    "Paragraph two — should render with the same line-height as paragraph one. Wrapped lines breathe; consecutive paragraphs still have normal after-spacing.",
                  ),
                ],
              }),
              new Paragraph({
                spacing: { line: 360, lineRule: LineRuleType.AUTO },
                children: [new TextRun("Paragraph three — same.")],
              }),
            ],
          },
        ],
      }),
  },

  {
    name: "04-numbered-list",
    category: "list",
    description:
      "Five-item numbered list. Tests numbering.xml import + per-level indent + contextualSpacing (Word renders consecutive list items tight).",
    build: () =>
      new Document({
        numbering: {
          config: [
            {
              reference: "numList",
              levels: [
                {
                  level: 0,
                  format: LevelFormat.DECIMAL,
                  text: "%1.",
                  alignment: AlignmentType.START,
                  style: {
                    paragraph: { indent: { left: 720, hanging: 360 } },
                  },
                },
              ],
            },
          ],
        },
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({ children: [new TextRun("Intro paragraph before the list.")] }),
              new Paragraph({
                numbering: { reference: "numList", level: 0 },
                children: [new TextRun("First item.")],
              }),
              new Paragraph({
                numbering: { reference: "numList", level: 0 },
                children: [new TextRun("Second item.")],
              }),
              new Paragraph({
                numbering: { reference: "numList", level: 0 },
                children: [
                  new TextRun(
                    "Third item — a longer one with enough text to wrap, demonstrating that wrapped lines align with the body text and not the marker.",
                  ),
                ],
              }),
              new Paragraph({
                numbering: { reference: "numList", level: 0 },
                children: [new TextRun("Fourth item.")],
              }),
              new Paragraph({
                numbering: { reference: "numList", level: 0 },
                children: [new TextRun("Fifth item.")],
              }),
              new Paragraph({ children: [new TextRun("Trailing paragraph after the list.")] }),
            ],
          },
        ],
      }),
  },

  {
    name: "05-bulleted-list-mixed",
    category: "list",
    description:
      "Two-level bulleted list. Exercises multi-level numbering definitions and per-level indent.",
    build: () =>
      new Document({
        numbering: {
          config: [
            {
              reference: "bullets",
              levels: [
                {
                  level: 0,
                  format: LevelFormat.BULLET,
                  text: "•",
                  alignment: AlignmentType.LEFT,
                  style: { paragraph: { indent: { left: 720, hanging: 360 } } },
                },
                {
                  level: 1,
                  format: LevelFormat.BULLET,
                  text: "◦",
                  alignment: AlignmentType.LEFT,
                  style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
                },
              ],
            },
          ],
        },
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                numbering: { reference: "bullets", level: 0 },
                children: [new TextRun("Top-level bullet A")],
              }),
              new Paragraph({
                numbering: { reference: "bullets", level: 1 },
                children: [new TextRun("Nested under A")],
              }),
              new Paragraph({
                numbering: { reference: "bullets", level: 1 },
                children: [new TextRun("Also nested under A")],
              }),
              new Paragraph({
                numbering: { reference: "bullets", level: 0 },
                children: [new TextRun("Top-level bullet B")],
              }),
              new Paragraph({
                numbering: { reference: "bullets", level: 0 },
                children: [new TextRun("Top-level bullet C")],
              }),
            ],
          },
        ],
      }),
  },

  {
    name: "06-mixed-fonts",
    category: "font",
    description:
      "Mixed run-level font swaps within one paragraph + a contrasting paragraph with a different font. Exercises rPr run-level overrides + style-cascade fallback.",
    build: () =>
      new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "Default font here. ", font: "Calibri" }),
                  new TextRun({ text: "Times New Roman here. ", font: "Times New Roman" }),
                  new TextRun({ text: "Back to Calibri. ", font: "Calibri" }),
                  new TextRun({ text: "Courier New monospace.", font: "Courier New" }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Whole paragraph in Georgia, with some bold and italic mixed in.",
                    font: "Georgia",
                  }),
                  new TextRun({ text: " Bold Georgia.", font: "Georgia", bold: true }),
                  new TextRun({ text: " Italic Georgia.", font: "Georgia", italics: true }),
                ],
              }),
            ],
          },
        ],
      }),
  },

  {
    name: "07-table-simple",
    category: "table",
    description:
      "3-column × 3-row table with default borders. Tests table cell rendering, default cell padding, and cell-level paragraph styles.",
    build: () => {
      const row = (cells: string[], header = false) =>
        new TableRow({
          tableHeader: header,
          height: { value: 360, rule: HeightRule.ATLEAST },
          children: cells.map(
            (text) =>
              new TableCell({
                width: { size: 3000, type: WidthType.DXA },
                shading: header
                  ? { type: ShadingType.CLEAR, fill: "EEEEEE", color: "auto" }
                  : undefined,
                children: [
                  new Paragraph({
                    children: [new TextRun({ text, bold: header })],
                  }),
                ],
              }),
          ),
        });
      return new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({ children: [new TextRun("Table below:")] }),
              // `columnWidths` is load-bearing: without it the docx
              // library emits a degenerate `<w:tblGrid>` of 100-twip
              // columns (its default) that contradicts the 3000-twip
              // `tcW` on every cell. LibreOffice honours the tiny grid
              // and collapses the table to a text-less sliver, so the
              // cell glyphs never reach the reference PDF and nine of
              // eleven blocks have nothing to match. Pin the grid to the
              // cell widths — what a real Word table always does.
              new Table({
                columnWidths: [3000, 3000, 3000],
                rows: [
                  row(["Header A", "Header B", "Header C"], true),
                  row(["Cell 1A", "Cell 1B", "Cell 1C"]),
                  row(["Cell 2A", "Cell 2B", "Cell 2C"]),
                ],
              }),
              new Paragraph({ children: [new TextRun("Paragraph after table.")] }),
            ],
          },
        ],
      });
    },
  },

  {
    name: "08-footer-page-numbers",
    category: "footer",
    description:
      "Multi-page doc with a footer containing PAGE / NUMPAGES fields. Tests footer parsing + field-token import (where this whole journey started).",
    build: () => {
      // Enough body paragraphs to force ~2 pages.
      const body: Paragraph[] = [];
      for (let i = 1; i <= 40; i++) {
        body.push(
          new Paragraph({
            children: [
              new TextRun(
                `Paragraph ${i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`,
              ),
            ],
          }),
        );
      }
      return new Document({
        sections: [
          {
            properties: {},
            children: body,
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun("Page "),
                      new TextRun({ children: [PageNumber.CURRENT] }),
                      new TextRun(" of "),
                      new TextRun({ children: [PageNumber.TOTAL_PAGES] }),
                    ],
                  }),
                ],
              }),
            },
          },
        ],
      });
    },
  },

  // ============================================================
  // Complex / real-world exemplars (09+) — interactions between
  // features the isolated 01-08 exemplars don't catch.
  // ============================================================

  {
    name: "09-contract-style",
    category: "contract",
    description:
      "Service-agreement layout: centred title, parties + form-fields table with shaded cells, numbered clauses (some multi-line), signature block. Mirrors a real legal contract — exercises Heading → BodyText → tight form-paragraph → table → numbered list → loose-paragraph transitions in one doc.",
    build: () => {
      const tight = (text: string): Paragraph => new Paragraph({ children: [new TextRun(text)] });
      const labelValueRow = (label: string, value: string): TableRow =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 2400, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" },
              children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
            }),
            new TableCell({
              width: { size: 6000, type: WidthType.DXA },
              children: [new Paragraph({ children: [new TextRun(value)] })],
            }),
          ],
        });
      return new Document({
        numbering: {
          config: [
            {
              reference: "clauses",
              levels: [
                {
                  level: 0,
                  format: LevelFormat.DECIMAL,
                  text: "%1.",
                  alignment: AlignmentType.START,
                  style: { paragraph: { indent: { left: 720, hanging: 360 } } },
                },
              ],
            },
          ],
        },
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                heading: HeadingLevel.HEADING_1,
                children: [new TextRun({ text: "Service Agreement", bold: true })],
              }),
              new Paragraph({ children: [new TextRun("")] }),
              new Paragraph({
                children: [
                  new TextRun("This Service Agreement (the “Agreement”) is entered into between:"),
                ],
              }),
              tight("Provider: Acme Consulting Ltd."),
              tight("Address: 1 Example Street, London, EC1A 1AA"),
              tight("Registered no.: 12345678"),
              new Paragraph({ children: [new TextRun("and:")] }),
              new Table({
                width: { size: 8400, type: WidthType.DXA },
                rows: [
                  labelValueRow("Client name", "John Doe"),
                  labelValueRow("Address", "42 High Street, London"),
                  labelValueRow("Contact", "john.doe@example.com"),
                ],
              }),
              new Paragraph({ children: [new TextRun("")] }),
              new Paragraph({
                children: [
                  new TextRun(
                    "The Parties agree to the following terms (collectively, the “Terms”):",
                  ),
                ],
              }),
              new Paragraph({
                numbering: { reference: "clauses", level: 0 },
                children: [
                  new TextRun({ text: "Scope. ", bold: true }),
                  new TextRun(
                    "Provider shall deliver consulting services as described in Schedule A, subject to revision by mutual written agreement.",
                  ),
                ],
              }),
              new Paragraph({
                numbering: { reference: "clauses", level: 0 },
                children: [
                  new TextRun({ text: "Term. ", bold: true }),
                  new TextRun(
                    "This Agreement shall commence on the date of signature and continue for an initial term of twelve (12) months, automatically renewing for successive twelve-month terms unless either Party gives at least thirty (30) days' written notice of non-renewal.",
                  ),
                ],
              }),
              new Paragraph({
                numbering: { reference: "clauses", level: 0 },
                children: [
                  new TextRun({ text: "Fees and Invoicing. ", bold: true }),
                  new TextRun(
                    "The Client shall pay the Provider the fees set out in Schedule B. Invoices are payable within thirty (30) days of issue. Late payment shall accrue interest at the rate of 8% above the Bank of England base rate per annum.",
                  ),
                ],
              }),
              new Paragraph({
                numbering: { reference: "clauses", level: 0 },
                children: [
                  new TextRun({ text: "Confidentiality. ", bold: true }),
                  new TextRun(
                    "Each Party shall keep confidential all information of the other Party marked as confidential or which a reasonable person would understand to be confidential.",
                  ),
                ],
              }),
              new Paragraph({
                numbering: { reference: "clauses", level: 0 },
                children: [
                  new TextRun({ text: "Governing Law. ", bold: true }),
                  new TextRun(
                    "This Agreement shall be governed by and construed in accordance with the laws of England and Wales.",
                  ),
                ],
              }),
              new Paragraph({ children: [new TextRun("")] }),
              new Paragraph({
                children: [new TextRun("Signed for and on behalf of the Parties:")],
              }),
              new Paragraph({ children: [new TextRun("")] }),
              new Paragraph({
                children: [new TextRun("……………………………………                      ……………………………………")],
              }),
              new Paragraph({
                children: [
                  new TextRun(
                    "Provider                                                                Client",
                  ),
                ],
              }),
            ],
          },
        ],
      });
    },
  },

  {
    name: "11-table-merged-cells",
    category: "table",
    description:
      "4×5 table with horizontal + vertical merges, header-row shading, status-coloured body cells (green/yellow/red), per-cell paragraph alignment. Single most bug-prone area in any docx renderer.",
    build: () => {
      const headerCell = (text: string): TableCell =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: "1F4E79", color: "auto" },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text, bold: true, color: "FFFFFF" })],
            }),
          ],
        });
      // Helper signatures use the docx-library's value types
      // (`AlignmentType`, `VerticalMergeType`) directly. Earlier
      // attempts narrowed `align` to `typeof AlignmentType.LEFT`,
      // which the docx-library's `Paragraph` constructor then refused
      // to accept any other variant for — TS reported "Type
      // 'center' is not assignable to type 'left'". Widening the
      // option types to the full enums lets every call site pass
      // whichever variant it needs.
      type CellOpts = {
        fill?: string;
        align?: (typeof AlignmentType)[keyof typeof AlignmentType];
        colSpan?: number;
        vMerge?: (typeof VerticalMergeType)[keyof typeof VerticalMergeType];
      };
      const cell = (text: string, opts: CellOpts = {}): TableCell =>
        new TableCell({
          shading: opts.fill
            ? { type: ShadingType.CLEAR, fill: opts.fill, color: "auto" }
            : undefined,
          columnSpan: opts.colSpan,
          verticalMerge: opts.vMerge,
          children: [
            new Paragraph({
              alignment: opts.align ?? AlignmentType.LEFT,
              children: [new TextRun(text)],
            }),
          ],
        });
      return new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                children: [
                  new TextRun(
                    "Quarterly status report — exercises merged cells and colour-coded backgrounds.",
                  ),
                ],
              }),
              new Table({
                width: { size: 9000, type: WidthType.DXA },
                rows: [
                  // Header row
                  new TableRow({
                    tableHeader: true,
                    height: { value: 400, rule: HeightRule.ATLEAST },
                    children: [
                      headerCell("Team"),
                      headerCell("Project"),
                      headerCell("Owner"),
                      headerCell("Status"),
                    ],
                  }),
                  // Row 2 — vMerge START in column 1, distinct row content
                  new TableRow({
                    children: [
                      cell("Engineering", { vMerge: VerticalMergeType.RESTART }),
                      cell("Auth refactor"),
                      cell("Alice"),
                      cell("On track", { fill: "C6EFCE", align: AlignmentType.CENTER }),
                    ],
                  }),
                  // Row 3 — vMerge CONTINUE merges with row 2's first cell
                  new TableRow({
                    children: [
                      cell("", { vMerge: VerticalMergeType.CONTINUE }),
                      cell("Pipeline migration"),
                      cell("Bob"),
                      cell("At risk", { fill: "FFEB9C", align: AlignmentType.CENTER }),
                    ],
                  }),
                  // Row 4 — fresh team
                  new TableRow({
                    children: [
                      cell("Design"),
                      cell("Onboarding redesign"),
                      cell("Carol"),
                      cell("Blocked", { fill: "FFC7CE", align: AlignmentType.CENTER }),
                    ],
                  }),
                  // Row 5 — horizontal merge across all 4 columns for a footer-style note
                  new TableRow({
                    children: [
                      cell(
                        "Note: figures revised against the previous quarter; see Schedule C for methodology.",
                        {
                          colSpan: 4,
                          fill: "F2F2F2",
                          align: AlignmentType.CENTER,
                        },
                      ),
                    ],
                  }),
                ],
              }),
              new Paragraph({ children: [new TextRun("Paragraph after the table.")] }),
            ],
          },
        ],
      });
    },
  },

  {
    name: "12-mixed-flow",
    category: "mixed",
    description:
      "Long alternating sequence: heading → body → numbered list → body → bulleted list → body → table (shaded header) → body → second numbered list (new numId, restarts at 1) → body. Stresses cascade transitions and verifies list state resets between non-list paragraphs.",
    build: () =>
      new Document({
        numbering: {
          config: [
            {
              reference: "firstNum",
              levels: [
                {
                  level: 0,
                  format: LevelFormat.DECIMAL,
                  text: "%1.",
                  alignment: AlignmentType.START,
                  style: { paragraph: { indent: { left: 720, hanging: 360 } } },
                },
              ],
            },
            {
              reference: "secondNum",
              levels: [
                {
                  level: 0,
                  format: LevelFormat.DECIMAL,
                  text: "%1.",
                  alignment: AlignmentType.START,
                  style: { paragraph: { indent: { left: 720, hanging: 360 } } },
                },
              ],
            },
            {
              reference: "bullets",
              levels: [
                {
                  level: 0,
                  format: LevelFormat.BULLET,
                  text: "•",
                  alignment: AlignmentType.LEFT,
                  style: { paragraph: { indent: { left: 720, hanging: 360 } } },
                },
              ],
            },
          ],
        },
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                heading: HeadingLevel.HEADING_1,
                children: [new TextRun("Mixed Flow")],
              }),
              new Paragraph({
                children: [
                  new TextRun(
                    "Body paragraph following the heading. The next block should be a numbered list starting at 1.",
                  ),
                ],
              }),
              new Paragraph({
                numbering: { reference: "firstNum", level: 0 },
                children: [new TextRun("First numbered item.")],
              }),
              new Paragraph({
                numbering: { reference: "firstNum", level: 0 },
                children: [new TextRun("Second numbered item.")],
              }),
              new Paragraph({
                numbering: { reference: "firstNum", level: 0 },
                children: [new TextRun("Third numbered item.")],
              }),
              new Paragraph({
                children: [
                  new TextRun(
                    "Body paragraph after the first numbered list. Next: a bulleted list — its <ul> must NOT be merged with the previous <ol>.",
                  ),
                ],
              }),
              new Paragraph({
                numbering: { reference: "bullets", level: 0 },
                children: [new TextRun("Bullet one.")],
              }),
              new Paragraph({
                numbering: { reference: "bullets", level: 0 },
                children: [new TextRun("Bullet two.")],
              }),
              new Paragraph({
                numbering: { reference: "bullets", level: 0 },
                children: [new TextRun("Bullet three.")],
              }),
              new Paragraph({
                children: [new TextRun("Body paragraph between bulleted list and table.")],
              }),
              new Table({
                width: { size: 6000, type: WidthType.DXA },
                rows: [
                  new TableRow({
                    tableHeader: true,
                    children: [
                      new TableCell({
                        shading: { type: ShadingType.CLEAR, fill: "DDEBF7", color: "auto" },
                        children: [
                          new Paragraph({ children: [new TextRun({ text: "Key", bold: true })] }),
                        ],
                      }),
                      new TableCell({
                        shading: { type: ShadingType.CLEAR, fill: "DDEBF7", color: "auto" },
                        children: [
                          new Paragraph({ children: [new TextRun({ text: "Value", bold: true })] }),
                        ],
                      }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [new Paragraph({ children: [new TextRun("alpha")] })],
                      }),
                      new TableCell({
                        children: [new Paragraph({ children: [new TextRun("1")] })],
                      }),
                    ],
                  }),
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [new Paragraph({ children: [new TextRun("beta")] })],
                      }),
                      new TableCell({
                        children: [new Paragraph({ children: [new TextRun("2")] })],
                      }),
                    ],
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun(
                    "Body paragraph after the table. The next block is a SECOND numbered list — a new numId, so it should restart at 1, not continue from 3.",
                  ),
                ],
              }),
              new Paragraph({
                numbering: { reference: "secondNum", level: 0 },
                children: [new TextRun("Restarted at 1 (new numId).")],
              }),
              new Paragraph({
                numbering: { reference: "secondNum", level: 0 },
                children: [new TextRun("Second item of the second list.")],
              }),
              new Paragraph({
                children: [new TextRun("Final trailing body paragraph.")],
              }),
            ],
          },
        ],
      }),
  },

  {
    name: "13-pagination-edge-cases",
    category: "pagination",
    description:
      "Stresses pagination: ~25 filler paragraphs pushing a Heading2 near the page boundary (keep-with-next should pull it forward with its next paragraph), a paragraph with pageBreakBefore, a single super-long paragraph that must split mid-page, and a numbered list with one oversized item that must split mid-LI.",
    build: () => {
      const filler = (n: number): Paragraph =>
        new Paragraph({
          children: [
            new TextRun(
              `Filler paragraph ${n}. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.`,
            ),
          ],
        });
      const longBlob = (label: string): string => {
        let out = `${label} `;
        for (let i = 0; i < 25; i++) {
          out +=
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
        }
        return out;
      };
      const children: Paragraph[] = [];
      for (let i = 1; i <= 18; i++) children.push(filler(i));
      // Heading near the boundary — keepNext should glue it to the next paragraph.
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          keepNext: true,
          children: [new TextRun("A heading near the page boundary")],
        }),
      );
      children.push(
        new Paragraph({
          children: [
            new TextRun(
              "This paragraph must travel together with the heading above. If you see the heading at the bottom of one page and this paragraph at the top of the next, keep-with-next is broken.",
            ),
          ],
        }),
      );
      for (let i = 19; i <= 22; i++) children.push(filler(i));
      // Forced page break before.
      children.push(
        new Paragraph({
          pageBreakBefore: true,
          children: [new TextRun("This paragraph starts on a fresh page (pageBreakBefore).")],
        }),
      );
      // Long paragraph that should split mid-paragraph.
      children.push(
        new Paragraph({
          children: [new TextRun(longBlob("Splittable paragraph."))],
        }),
      );
      // Numbered list with one super-long item to exercise mid-LI split.
      const config = {
        reference: "longList",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      };
      children.push(
        new Paragraph({
          numbering: { reference: "longList", level: 0 },
          children: [new TextRun("Short item one.")],
        }),
        new Paragraph({
          numbering: { reference: "longList", level: 0 },
          children: [new TextRun("Short item two.")],
        }),
        new Paragraph({
          numbering: { reference: "longList", level: 0 },
          children: [new TextRun(longBlob("Oversized item three —"))],
        }),
        new Paragraph({
          numbering: { reference: "longList", level: 0 },
          children: [new TextRun("Short item four.")],
        }),
      );
      return new Document({
        numbering: { config: [config] },
        sections: [{ properties: {}, children }],
      });
    },
  },
];

async function main(): Promise<void> {
  for (const fixture of FIXTURES) {
    const doc = fixture.build();
    const buf = await Packer.toBuffer(doc);
    const slugDir = join(CORPUS_ROOT, fixture.category, fixture.name);
    await mkdir(slugDir, { recursive: true });
    const out = join(slugDir, "source.docx");
    await writeFile(out, buf);
    process.stdout.write(
      `✓ ${fixture.category}/${fixture.name}/source.docx (${buf.byteLength} bytes) — ${fixture.description}\n`,
    );
  }

  process.stdout.write(`\nGenerated ${FIXTURES.length} fixtures under ${CORPUS_ROOT}\n`);
}

main().catch((err) => {
  process.stderr.write(
    `fixtures-gen failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
