import type { PageSetup, PageZoneText } from "../paperStack/pageSetup";
import { PAGE_SIZES } from "../paperStack/pageSetup";
import { text as textRun } from "./builders";
import { fieldType } from "./fields";
import type {
  Block,
  FieldRun,
  HeaderFooterRef,
  InlineRun,
  Paragraph,
  SectionProperties,
  TextRun,
} from "./types";

/**
 * Temporary bridge between Sobree's legacy `PageSetup`/`PageZoneText` model
 * and the native OOXML-flavoured `SectionProperties` + `headerFooterBodies`.
 *
 * Lives in `src/doc/` so both the Sobree façade and the docx import/export
 * modules can import it without creating a layer-violation. Deleted when
 * the editor is cut over to the native AST directly (Phase N4).
 */

const MM_TO_TWIPS = 56.6929133858; // 1440 / 25.4

export interface SectionMaterials {
  section: SectionProperties;
  headerFooterBodies: Record<string, Block[]>;
}

/**
 * Translate `PageSetup` → `SectionProperties` plus the header/footer body
 * blocks. Allocates part ids (`header1.xml`, `footer1.xml`, …) following
 * Word's canonical numbering.
 */
export function pageSetupToSection(setup: PageSetup): SectionMaterials {
  const section: SectionProperties = {
    pageSize: pageSizeToTwips(setup),
    pageMargins: marginsToTwips(setup.margins),
    headerRefs: [],
    footerRefs: [],
  };
  if (setup.verticalAlign && setup.verticalAlign !== "top") {
    section.vAlign = setup.verticalAlign;
  }
  const bodies: Record<string, Block[]> = {};
  let fileIdx = 1;

  const attach = (kind: "header" | "footer", type: "default" | "first", template: string) => {
    const partId = `${kind}${fileIdx}.xml`;
    fileIdx += 1;
    const ref: HeaderFooterRef = { type, partId };
    if (kind === "header") section.headerRefs.push(ref);
    else section.footerRefs.push(ref);
    bodies[partId] = templateToBlocks(template);
  };

  if (zoneHasContent(setup.header)) {
    attach("header", "default", setup.header.default);
    if (setup.header.differentFirst && setup.header.first) {
      attach("header", "first", setup.header.first);
    }
  }
  if (zoneHasContent(setup.footer)) {
    attach("footer", "default", setup.footer.default);
    if (setup.footer.differentFirst && setup.footer.first) {
      attach("footer", "first", setup.footer.first);
    }
  }
  if (setup.header.differentFirst || setup.footer.differentFirst) {
    section.titlePage = true;
  }

  return { section, headerFooterBodies: bodies };
}

/**
 * Translate `SectionProperties` + header/footer bodies → a sparse
 * `Partial<PageSetup>`. Keys are only present if the section actually
 * specified them, so callers can merge cleanly with their current setup.
 */
export function sectionToPageSetup(
  section: SectionProperties,
  bodies: Record<string, Block[]>,
): Partial<PageSetup> {
  const out: Partial<PageSetup> = {};

  const { size, orientation } = matchPageSize(section.pageSize.wTwips, section.pageSize.hTwips);
  out.size = size;
  out.orientation = orientation;

  out.margins = {
    top: roundMm(section.pageMargins.topTwips),
    right: roundMm(section.pageMargins.rightTwips),
    bottom: roundMm(section.pageMargins.bottomTwips),
    left: roundMm(section.pageMargins.leftTwips),
  };

  const header = refsToZoneText(section.headerRefs, bodies, section.titlePage === true);
  if (header) out.header = header;
  const footer = refsToZoneText(section.footerRefs, bodies, section.titlePage === true);
  if (footer) out.footer = footer;

  if (section.vAlign) out.verticalAlign = section.vAlign;

  return out;
}

function refsToZoneText(
  refs: HeaderFooterRef[],
  bodies: Record<string, Block[]>,
  differentFirst: boolean,
): PageZoneText | null {
  if (refs.length === 0) return null;
  const zone: PageZoneText = {
    default: "",
    first: "",
    last: "",
    differentFirst,
    differentLast: false,
  };
  for (const ref of refs) {
    if (ref.type === "even") continue;
    const body = bodies[ref.partId];
    if (!body) continue;
    const text = blocksToTemplate(body);
    if (ref.type === "first") zone.first = text;
    else zone.default = text;
  }
  return zone.default || zone.first ? zone : null;
}

function pageSizeToTwips(setup: PageSetup) {
  const size = PAGE_SIZES[setup.size];
  const [widthMm, heightMm] =
    setup.orientation === "portrait" ? [size.width, size.height] : [size.height, size.width];
  return {
    wTwips: Math.round(widthMm * MM_TO_TWIPS),
    hTwips: Math.round(heightMm * MM_TO_TWIPS),
    orientation: setup.orientation,
  };
}

function marginsToTwips(m: PageSetup["margins"]) {
  return {
    topTwips: Math.round(m.top * MM_TO_TWIPS),
    rightTwips: Math.round(m.right * MM_TO_TWIPS),
    bottomTwips: Math.round(m.bottom * MM_TO_TWIPS),
    leftTwips: Math.round(m.left * MM_TO_TWIPS),
    headerTwips: 720,
    footerTwips: 720,
    gutterTwips: 0,
  };
}

function matchPageSize(widthTwips: number, heightTwips: number) {
  const widthMm = widthTwips / MM_TO_TWIPS;
  const heightMm = heightTwips / MM_TO_TWIPS;
  const portrait = heightMm >= widthMm;
  const [w, h] = portrait ? [widthMm, heightMm] : [heightMm, widthMm];

  let best: keyof typeof PAGE_SIZES = "A4";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [key, mm] of Object.entries(PAGE_SIZES)) {
    const d = Math.abs(mm.width - w) + Math.abs(mm.height - h);
    if (d < bestDist) {
      bestDist = d;
      best = key as keyof typeof PAGE_SIZES;
    }
  }
  return { size: best, orientation: portrait ? ("portrait" as const) : ("landscape" as const) };
}

function zoneHasContent(z: PageZoneText): boolean {
  return z.default.length > 0 || (z.differentFirst && z.first.length > 0);
}

function roundMm(twips: number): number {
  return Math.round(twips / MM_TO_TWIPS);
}

/**
 * Parse a header/footer template (plain text with `{page}` / `{pages}`
 * tokens) into Block[] — one paragraph per line. Field tokens become
 * FieldRun nodes so Word's PAGE/NUMPAGES field codes emit naturally.
 */
export function templateToBlocks(template: string): Block[] {
  const lines = template.split(/\r?\n/);
  return lines.map((line) => lineToParagraph(line));
}

function lineToParagraph(line: string): Paragraph {
  const runs: InlineRun[] = [];
  const regex = /\{(page|pages)\}/g;
  let last = 0;
  let m: RegExpExecArray | null = regex.exec(line);
  while (m !== null) {
    if (m.index > last) runs.push(textRun(line.slice(last, m.index)));
    const field: FieldRun = {
      kind: "field",
      instruction: m[1] === "page" ? "PAGE" : "NUMPAGES",
      cached: "",
    };
    runs.push(field);
    last = m.index + m[0].length;
    m = regex.exec(line);
  }
  if (last < line.length) runs.push(textRun(line.slice(last)));
  return { kind: "paragraph", properties: {}, runs };
}

/** Reverse of `templateToBlocks`. Used on import. */
export function blocksToTemplate(blocks: readonly Block[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.kind !== "paragraph") continue;
    let line = "";
    for (const run of block.runs) {
      if (run.kind === "text") line += (run as TextRun).text;
      else if (run.kind === "field") {
        const type = fieldType(run.instruction);
        if (type === "PAGE") line += "{page}";
        else if (type === "NUMPAGES") line += "{pages}";
      } else if (run.kind === "break") line += "\n";
    }
    lines.push(line);
  }
  // Collapse leading/trailing empty lines but preserve interior blanks.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  while (lines.length > 0 && lines[0] === "") lines.shift();
  return lines.join("\n");
}
