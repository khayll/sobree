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
 * Current known gaps (audited 2026-06):
 *   - `inline_frame` blocks are not exported (DrawingML group
 *     serialization not implemented) — dropped from the body.
 *   - `anchoredFrames` / `headerFooterFrames` are not exported —
 *     floating drawings dropped (and media referenced only by them).
 *   - Anchored / float drawing RUNS export as inline pictures
 *     (placement + wrap geometry degrade; the image itself survives).
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

/**
 * Footnote bodies at the SAME bar as the document body — content &
 * structure signatures, not deep equality. Formatting fidelity of what
 * the exporter supports is covered by the focused `export/notes.test.ts`
 * suite; deep equality here would additionally demand paragraph
 * properties the exporter doesn't emit for ANY paragraph yet
 * (`runDefaults`, `tabStops` — a generic `renderPPr` gap, tracked in
 * devdocs/plan-ooxml-full-support.md).
 */
function noteSignatures(doc: SobreeDocument): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, blocks] of Object.entries(doc.footnotes ?? {})) {
    out[id] = blockSignatures(blocks);
  }
  return out;
}

/** Comment threads: deep equality on the METADATA (author / initials /
 *  date / done / replyToId), body at the signature bar (see above). */
function commentSignatures(doc: SobreeDocument): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, c] of Object.entries(doc.comments ?? {})) {
    out[id] = {
      author: c.author ?? null,
      initials: c.initials ?? null,
      date: c.date ?? null,
      done: c.done ?? false,
      replyToId: c.replyToId ?? null,
      body: blockSignatures(c.body),
    };
  }
  return out;
}

/** Project the imported document onto what the CURRENT exporter is
 *  expected to preserve (the documented-gap transform). */
function expectedAfterExport(doc: SobreeDocument): {
  bodySignatures: string[];
  footnotes: unknown;
  comments: unknown;
  numbering: unknown;
  sectionGeometry: unknown;
  listRefs: string[];
} {
  const body = doc.body.filter((b) => b.kind !== "inline_frame");
  return {
    bodySignatures: blockSignatures(body),
    footnotes: noteSignatures(doc),
    comments: commentSignatures(doc),
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
      expect(
        commentSignatures(d2),
        "comment threads (word/comments.xml + commentsExtended round-trip)",
      ).toEqual(want.comments);
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
