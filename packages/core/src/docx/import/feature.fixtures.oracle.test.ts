/**
 * Rendering-fidelity oracle.
 *
 * For each corpus entry
 * (`tests/corpus/<origin>/<category>/<slug>/source.docx`), runs the
 * full import → render pipeline in jsdom and snapshots the computed
 * styles of every top-level block (plus nested LIs and table cells).
 * Snapshots land at `<slug>/sobree/snapshot.json`.
 *
 * Workflow:
 *
 *   1. Author / regenerate the docx via `@sobree/fixtures-gen` (writes
 *      to `tests/corpus/generated/<category>/<slug>/source.docx`).
 *   2. Open the docx in Word / LibreOffice, screenshot to compare
 *      against the rendered Sobree output (per-fixture README docs
 *      live alongside).
 *   3. Run this test (`pnpm test`). First run writes the snapshot;
 *      subsequent runs compare and FAIL on diff.
 *   4. When a rendering change is intentional, update snapshots with
 *      `pnpm test -- -u` and visually verify against LibreOffice that
 *      Sobree's output still matches.
 *
 * The snapshots are the "doesn't go backwards" property: every
 * refactor must keep them green, or the diff explicitly shows what
 * changed for review.
 *
 * What we capture per block (and each LI / cell):
 *
 *   - `tag` + truncated `text` (for identification when reading diffs)
 *   - inline `style` attribute (Sobree's explicit declarations)
 *   - resolved `attrs` (start, data-* for OLs etc.)
 *   - children when relevant (LIs in OLs, cells in tables)
 *
 * We deliberately read inline style + element attributes rather than
 * `getComputedStyle` — jsdom doesn't run layout, so computed values
 * for inherited properties are unreliable; inline style captures
 * exactly what the renderer declared, which is the property we want
 * to assert on.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderBlocks } from "../../editor/view/docRenderer/block";
import { importDocx } from "./index";

const CORPUS_DIR = join(__dirname, "..", "..", "..", "..", "..", "tests", "corpus");

interface BlockSnapshot {
  tag: string;
  text?: string;
  style?: string;
  attrs?: Record<string, string>;
  children?: BlockSnapshot[];
}

function snapshotElement(el: Element, maxTextLen = 60): BlockSnapshot {
  const out: BlockSnapshot = { tag: el.tagName };
  const text = (el.textContent ?? "").trim();
  if (text.length > 0) {
    out.text = text.length > maxTextLen ? `${text.slice(0, maxTextLen)}…` : text;
  }
  const style = el.getAttribute("style");
  if (style) out.style = style;
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === "style") continue;
    if (attr.name === "data-section-index") continue; // noise
    if (attr.name === "data-block-id") continue; // generated id, varies
    if (attr.name === "data-pag-pid" || attr.name === "data-pag-lid") continue;
    attrs[attr.name] = attr.value;
  }
  if (Object.keys(attrs).length > 0) out.attrs = attrs;
  // Recurse into containers: OL/UL → LIs, TABLE → rows → cells.
  if (el.tagName === "OL" || el.tagName === "UL") {
    out.children = Array.from(el.children).map((c) => snapshotElement(c));
  } else if (el.tagName === "TABLE") {
    out.children = Array.from(el.children).map((c) => snapshotElement(c));
  } else if (el.tagName === "TBODY" || el.tagName === "THEAD" || el.tagName === "TR") {
    out.children = Array.from(el.children).map((c) => snapshotElement(c));
  } else if (el.tagName === "TD" || el.tagName === "TH") {
    out.children = Array.from(el.children).map((c) => snapshotElement(c));
  }
  return out;
}

/**
 * A unit of the oracle: source docx + where to write the snapshot
 * file. Every entry lives at
 * `tests/corpus/<origin>/<category>/<slug>/source.docx`; snapshots
 * land adjacent in `<slug>/sobree/snapshot.json` so the corpus
 * runner (`pnpm corpus:check`) can pick them up.
 */
interface OracleTarget {
  /** Display name for the test (slug). */
  label: string;
  /** Absolute path to the docx file. */
  docxPath: string;
  /** Absolute path the snapshot json should be written to. */
  snapshotPath: string;
}

function collectTargets(): OracleTarget[] {
  const out: OracleTarget[] = [];
  if (!existsSync(CORPUS_DIR)) return out;
  // `generated/` is committed and gates CI; `real-world/` is gitignored
  // (local machines only), so including it costs CI nothing while
  // producing the snapshots the corpus runner needs to diff real
  // documents locally.
  for (const origin of ["generated", "real-world"]) {
    const originDir = join(CORPUS_DIR, origin);
    if (!existsSync(originDir)) continue;
    for (const category of readdirSync(originDir)) {
      const categoryDir = join(originDir, category);
      try {
        for (const slug of readdirSync(categoryDir)) {
          const slugDir = join(categoryDir, slug);
          const docx = join(slugDir, "source.docx");
          if (!existsSync(docx)) continue;
          out.push({
            label: `corpus/${origin}/${category}/${slug}`,
            docxPath: docx,
            snapshotPath: join(slugDir, "sobree", "snapshot.json"),
          });
        }
      } catch {
        /* not a directory, skip */
      }
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

describe("rendering-fidelity oracle", () => {
  for (const target of collectTargets()) {
    it(target.label, async () => {
      const buf = readFileSync(target.docxPath);
      // Pass as Uint8Array — importDocx accepts that branch.
      const u8 = new Uint8Array(buf);
      const { document: doc, warnings } = await importDocx(u8);

      const host = window.document.createElement("div");
      host.className = "sobree-editor";
      window.document.body.appendChild(host);
      try {
        renderBlocks(doc.body, host, doc.numbering, doc.styles, doc.rawParts, undefined);
        const snapshot = {
          fixture: target.label,
          importWarnings: warnings,
          numberingDefs: doc.numbering.length,
          styles: doc.styles
            .filter((s) => s.type === "paragraph")
            .map((s) => ({
              id: s.id,
              basedOn: s.basedOn,
              runDefaults: s.runDefaults,
              paragraphDefaults: s.paragraphDefaults,
            })),
          blocks: Array.from(host.children).map((c) => snapshotElement(c)),
        };
        await expect(snapshot).toMatchFileSnapshot(target.snapshotPath);
      } finally {
        host.remove();
      }
    });
  }
});
