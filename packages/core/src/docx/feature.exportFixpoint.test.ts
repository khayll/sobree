/**
 * Export fixpoint invariant — what an open → save cycle preserves.
 *
 * Export regenerates the OOXML from the AST (it does not splice
 * original XML), so the meaningful losslessness property is the AST
 * fixpoint: for every corpus document,
 *
 *   import(export(import(docx)))  ≡  import(docx)
 *
 * …modulo the KNOWN EXPORTER GAPS encoded in `expectedAfterExport`
 * below. Each entry there is a documented fidelity loss with an owner
 * feature; when an exporter gains support for one, delete its transform
 * and this test gets stricter automatically.
 *
 * Current known gaps (audited 2026-07):
 *   - `inline_frame` blocks whose group holds NEITHER a textbox nor a
 *     picture (pure decorative shape groups) are not exported — no
 *     import path reclaims that wire shape yet.
 *   - EVEN-page header/footer parts are not emitted (`emitHeadersAndFooters`
 *     skips `type === "even"` refs — a pre-existing scope cut; proper
 *     support needs `w:evenAndOddHeaders` settings plumbing). Their
 *     bodies AND floating frames drop on save.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Block, InlineRun, SobreeDocument } from "../doc/types";
import { exportDocx } from "./export";
import { importDocx } from "./import";

const CORPUS_DIR = join(__dirname, "..", "..", "..", "..", "tests", "corpus");

function safeDirs(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Same generic corpus walk as the Y.Doc parity test: the committed
 *  `generated/` corpus gates CI; local-only docs run when present. */
function collectFixtures(): Array<{ slug: string; path: string }> {
  const out: Array<{ slug: string; path: string }> = [];
  for (const origin of safeDirs(CORPUS_DIR)) {
    for (const category of safeDirs(join(CORPUS_DIR, origin))) {
      for (const slug of safeDirs(join(CORPUS_DIR, origin, category))) {
        const docx = join(CORPUS_DIR, origin, category, slug, "source.docx");
        if (existsSync(docx)) out.push({ slug: `${origin}/${category}/${slug}`, path: docx });
      }
    }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Per-block signature: kind + flattened text. Coarser than deep
 *  equality on purpose — formatting fidelity is covered by the focused
 *  round-trip suites; THIS test guards content & structure survival. */
function blockSignatures(blocks: readonly Block[]): string[] {
  const text = (runs: readonly InlineRun[]): string =>
    runs
      .map((r) =>
        r.kind === "text" ? r.text : r.kind === "hyperlink" ? text(r.children) : `[${r.kind}]`,
      )
      .join("");
  return blocks.map((b) => (b.kind === "paragraph" ? `p:${text(b.runs)}` : b.kind));
}

/** Footnote bodies at DEEP equality — the `renderPPr` gaps that forced
 *  a signature-only bar (`runDefaults` / `tabStops`, plan item 2e) are
 *  closed, so the whole block structure must survive. */
function noteSignatures(doc: SobreeDocument): unknown {
  return JSON.parse(JSON.stringify(doc.footnotes ?? {}));
}

/** Endnote bodies, deep equality — same bar as footnotes. */
function endnoteSignatures(doc: SobreeDocument): unknown {
  return JSON.parse(JSON.stringify(doc.endnotes ?? {}));
}

/** Comment threads at deep equality (metadata AND bodies — see above). */
function commentSignatures(doc: SobreeDocument): unknown {
  return JSON.parse(JSON.stringify(doc.comments ?? {}));
}

/** Project the imported document onto what the CURRENT exporter is
 *  expected to preserve (the documented-gap transform). */
/**
 * Anchored-frame signatures at the structure/geometry bar: everything the
 * exporter serializes must survive — content kind, anchor origin, offsets
 * and positioning forms, size (incl. percent forms), wrap and z-state.
 * Frame ids are import-order artifacts and body/textbox content is
 * covered by the body-signature machinery, so neither is compared here.
 */
function frameSignatures(doc: SobreeDocument): unknown[] {
  return frameSignaturesOf(doc.anchoredFrames ?? []);
}

function frameSignaturesOf(
  frames: readonly NonNullable<SobreeDocument["anchoredFrames"]>[number][],
): unknown[] {
  return frames.map((f) => ({
    kind: f.content.kind,
    // A frame with no host paragraph (its drawing sat outside the body
    // paragraph map, e.g. in a table cell) re-exports hosted at
    // paragraph 0. For page/margin-relative positioning — the only kind
    // the importer produces host-less — the host paragraph only decides
    // which page's flow carries the anchor, so `undefined ≈ 0` is the
    // same placement, not a loss.
    anchor: { ...f.anchor, paragraphIndex: f.anchor.paragraphIndex ?? 0 },
    offsetXEmu: f.offsetXEmu,
    offsetYEmu: f.offsetYEmu,
    alignH: f.alignH ?? null,
    alignV: f.alignV ?? null,
    pctPosX: f.pctPosX ?? null,
    pctPosY: f.pctPosY ?? null,
    pctWidth: f.pctWidth ?? null,
    pctHeight: f.pctHeight ?? null,
    widthEmu: f.widthEmu,
    heightEmu: f.heightEmu,
    wrap: f.wrap ?? null,
    wrapText: f.wrapText ?? null,
    behindText: f.behindText ?? false,
    textDistancesEmu: f.textDistancesEmu ?? null,
  }));
}

/**
 * Header/footer floating frames, per part, at the frame-signature bar.
 * Parts reachable ONLY through even-page refs are excluded — the even
 * scope cut above drops the whole part, frames included.
 */
function headerFrameSignatures(doc: SobreeDocument): Record<string, unknown[]> {
  const emitted = new Set<string>();
  for (const section of doc.sections) {
    for (const ref of [...section.headerRefs, ...section.footerRefs]) {
      if (ref.type !== "even") emitted.add(ref.partId);
    }
  }
  const out: Record<string, unknown[]> = {};
  for (const [partId, frames] of Object.entries(doc.headerFooterFrames ?? {})) {
    if (frames.length === 0 || !emitted.has(partId)) continue;
    out[partId] = frameSignaturesOf(frames);
  }
  return out;
}

/**
 * Content-control groups: consecutive body blocks sharing one SdtWrap,
 * as (prXml, member count) in document order. Ids are import-order
 * artifacts, so only the grouping and the verbatim properties compare.
 */
function sdtGroupSignatures(doc: SobreeDocument): Array<{ prXml: string; members: number }> {
  const out: Array<{ prXml: string; members: number }> = [];
  let openId: number | undefined;
  for (const block of doc.body) {
    const sdt =
      block.kind === "paragraph" || block.kind === "table" ? block.properties.sdt : undefined;
    if (!sdt) {
      openId = undefined;
      continue;
    }
    if (openId === sdt.id && out.length > 0) {
      out[out.length - 1]!.members++;
    } else {
      out.push({ prXml: sdt.prXml, members: 1 });
      openId = sdt.id;
    }
  }
  return out;
}

function expectedAfterExport(doc: SobreeDocument): {
  bodySignatures: string[];
  footnotes: unknown;
  endnotes: unknown;
  comments: unknown;
  frames: unknown[];
  headerFrames: Record<string, unknown[]>;
  sdtGroups: unknown[];
  numbering: unknown;
  sectionGeometry: unknown;
  listRefs: string[];
} {
  const body = doc.body.filter(
    (b) => b.kind !== "inline_frame" || b.textboxes.length > 0 || b.pictures.length > 0,
  );
  return {
    bodySignatures: blockSignatures(body),
    footnotes: noteSignatures(doc),
    endnotes: endnoteSignatures(doc),
    comments: commentSignatures(doc),
    frames: frameSignatures(doc),
    headerFrames: headerFrameSignatures(doc),
    sdtGroups: sdtGroupSignatures(doc),
    numbering: JSON.parse(JSON.stringify(doc.numbering)),
    sectionGeometry: doc.sections.map((s) => ({
      pageSize: s.pageSize,
      pageMargins: s.pageMargins,
      type: s.type ?? null,
      vAlign: s.vAlign ?? null,
      columns: s.columns ?? null,
    })),
    listRefs: body
      .filter((b) => b.kind === "paragraph" && b.properties.numbering)
      .map((b) => (b.kind === "paragraph" ? JSON.stringify(b.properties.numbering) : ""))
      .sort(),
  };
}

describe("export fixpoint — open → save preserves the document", () => {
  for (const { slug, path } of collectFixtures()) {
    it(slug, async () => {
      const d1 = (await importDocx(new Uint8Array(readFileSync(path)))).document;
      const out = exportDocx(d1);
      const d2 = (await importDocx(out.bytes)).document;

      const want = expectedAfterExport(d1);
      expect(blockSignatures(d2.body), "body content/structure").toEqual(want.bodySignatures);
      expect(noteSignatures(d2), "footnote bodies (word/footnotes.xml round-trip)").toEqual(
        want.footnotes,
      );
      expect(endnoteSignatures(d2), "endnote bodies (word/endnotes.xml round-trip)").toEqual(
        want.endnotes,
      );
      expect(
        commentSignatures(d2),
        "comment threads (word/comments.xml + commentsExtended round-trip)",
      ).toEqual(want.comments);
      expect(frameSignatures(d2), "anchored frames (wp:anchor round-trip)").toEqual(want.frames);
      expect(
        headerFrameSignatures(d2),
        "header/footer floating frames (per-part wp:anchor round-trip)",
      ).toEqual(want.headerFrames);
      expect(sdtGroupSignatures(d2), "content-control groups (w:sdt round-trip)").toEqual(
        want.sdtGroups,
      );
      expect(JSON.parse(JSON.stringify(d2.numbering)), "numbering definitions").toEqual(
        want.numbering,
      );
      expect(
        d2.sections.map((s) => ({
          pageSize: s.pageSize,
          pageMargins: s.pageMargins,
          type: s.type ?? null,
          vAlign: s.vAlign ?? null,
          columns: s.columns ?? null,
        })),
        "section geometry",
      ).toEqual(want.sectionGeometry);
      const d2ListRefs = d2.body
        .filter((b) => b.kind === "paragraph" && b.properties.numbering)
        .map((b) => (b.kind === "paragraph" ? JSON.stringify(b.properties.numbering) : ""))
        .sort();
      expect(d2ListRefs, "list membership (numId/level refs)").toEqual(want.listRefs);
    });
  }
});
