/**
 * Y.Doc parity invariant — the "lossless" guarantee, as a test.
 *
 * A refresh (and every collab peer) renders from the Y.Doc projection,
 * not from the original import. So for EVERY corpus document:
 *
 *   importDocx → seedYDoc → projectYDoc  must equal  importDocx
 *
 * This is the structural complement to the per-kind round-trip tests in
 * `runs.test.ts`: any AST field or node kind that the transport drops —
 * anywhere in the document — fails here, without anyone having to
 * remember to write a field-level test. (Bug history: `DrawingRun.
 * floatMarginsEmu` and the `footnoteRef`/`commentRef` run kinds were
 * silently dropped by an enumerated embed encoding; the corpus render
 * gate couldn't catch it because it renders fresh imports.)
 *
 * Known, documented normalisation (applies to BOTH sides):
 *   - Adjacent text runs with identical properties merge — Y.Text
 *     stores characters, not run boundaries, so two identically-
 *     formatted neighbouring runs are one span in the CRDT.
 *   - JSON round-trip — the transport stores JSON; an `undefined`
 *     field and an absent field are the same document.
 *   - `rawParts` compared by key set (binary payloads aren't JSON).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { Block, InlineRun, SobreeDocument } from "../doc/types";
import { importDocx } from "../docx/import";
import { projectYDoc } from "./project";
import { seedYDoc } from "./seed";

const CORPUS_DIR = join(__dirname, "..", "..", "..", "..", "tests", "corpus");

/** Scan every `<origin>/<category>/<slug>/source.docx` under the corpus
 *  root — the same generic walk `discoverCorpus` uses. The committed
 *  `generated/` corpus always runs (CI); the gitignored local-only
 *  corpus is exercised too when present, for free. */
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

function safeDirs(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** JSON round-trip: `undefined` fields and absent fields are the same
 *  document as far as the JSON-clean AST is concerned. */
function j<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function mergeAdjacentText(runs: readonly InlineRun[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const run of runs) {
    const mapped: InlineRun =
      run.kind === "hyperlink" ? { ...run, children: mergeAdjacentText(run.children) } : run;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.kind === "text" &&
      mapped.kind === "text" &&
      JSON.stringify(prev.properties) === JSON.stringify(mapped.properties)
    ) {
      out[out.length - 1] = { ...prev, text: prev.text + mapped.text };
      continue;
    }
    out.push(mapped);
  }
  return out;
}

function normalizeBlocks(blocks: readonly Block[]): Block[] {
  return blocks.map((b) => {
    if (b.kind === "paragraph") return { ...b, runs: mergeAdjacentText(b.runs) };
    // Tables now store cell content as nested Y structure, so cell paragraphs
    // coalesce adjacent same-property runs exactly like body paragraphs —
    // recurse so the comparison tolerates the same (lossless) normalization.
    if (b.kind === "table") {
      return {
        ...b,
        rows: b.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => ({ ...cell, content: normalizeBlocks(cell.content) })),
        })),
      };
    }
    return b;
  });
}

describe("Y.Doc parity — import → seed → project is lossless", () => {
  for (const { slug, path } of collectFixtures()) {
    it(slug, async () => {
      const { document: doc } = await importDocx(new Uint8Array(readFileSync(path)));
      const ydoc = new Y.Doc();
      seedYDoc(
        ydoc,
        doc,
        doc.body.map((_, i) => `b${i}`),
      );
      const { doc: out } = projectYDoc(ydoc);

      expect(j(normalizeBlocks(out.body))).toEqual(j(normalizeBlocks(doc.body)));
      const meta: Array<[keyof SobreeDocument, unknown]> = [
        ["sections", []],
        ["styles", []],
        ["numbering", []],
        ["headerFooterBodies", {}],
        ["headerFooterFrames", {}],
        ["anchoredFrames", []],
        ["footnotes", {}],
        ["comments", {}],
        ["settings", {}],
      ];
      for (const [field, empty] of meta) {
        expect(j(out[field] ?? empty), String(field)).toEqual(j(doc[field] ?? empty));
      }
      expect(Object.keys(out.rawParts).sort()).toEqual(Object.keys(doc.rawParts).sort());
    });
  }
});
