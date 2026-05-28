/**
 * Reference-counting / garbage-collection for the document's binary
 * `rawParts`. The naive policy "keep everything that came in on
 * import" leaves orphan images behind; with embedded fonts adding more
 * parts (Phase 3), an explicit liveness model becomes essential.
 *
 * A part path is **live** if at least one of these references it:
 *   - a `DrawingRun.partPath` anywhere in `doc.body` (including nested
 *     paragraphs inside table cells).
 *   - a `DrawingRun.partPath` inside any header/footer template body.
 *   - a font embed declared on a `SobreeDocument.fonts` entry (Phase 3
 *     adds this — until then `fonts` is `[]` and the loop is a no-op).
 *
 * The result feeds two callers:
 *   - `editor.pruneUnusedParts()` — explicit GC after a sequence of
 *     edits (e.g. deleting an image).
 *   - `exportDocx` — packaging only stages live parts into the ZIP, so
 *     orphans drop on round-trip without an explicit prune.
 */

import type { Block, InlineRun, SobreeDocument } from "./types";
import { walkBlock } from "./walk";
import { fontLivenessPaths } from "../fonts/liveness";

/**
 * Walk the document and return the set of `rawParts` keys that
 * something in the AST still points at. Anything else is an orphan.
 */
export function collectLivePartPaths(doc: SobreeDocument): Set<string> {
  const live = new Set<string>();

  // Body + every table cell.
  for (const block of doc.body) collectFromBlock(block, live);

  // Header + footer templates — same shape as body, separate trees.
  for (const blocks of Object.values(doc.headerFooterBodies)) {
    for (const block of blocks) collectFromBlock(block, live);
  }

  // Embedded font parts. The fonts module owns its own walker so the
  // liveness logic stays font-agnostic here.
  for (const path of fontLivenessPaths(doc)) live.add(path);

  return live;
}

function collectFromBlock(block: Block, live: Set<string>): void {
  walkBlock(block, {
    run: (run: InlineRun) => {
      if (run.kind === "drawing" && run.partPath) live.add(run.partPath);
    },
  });
}

/**
 * Return a new document whose `rawParts` only contains live keys.
 * Reports which keys were dropped. The document is otherwise unchanged
 * — no AST mutation, no version bumps, no header/footer churn.
 *
 * Idempotent: pruning an already-clean doc is a no-op.
 */
export function pruneOrphanParts(doc: SobreeDocument): {
  doc: SobreeDocument;
  kept: number;
  pruned: string[];
} {
  const live = collectLivePartPaths(doc);
  const next: Record<string, Uint8Array> = {};
  const pruned: string[] = [];
  for (const [path, bytes] of Object.entries(doc.rawParts)) {
    if (live.has(path)) next[path] = bytes;
    else pruned.push(path);
  }
  return {
    doc: pruned.length === 0 ? doc : { ...doc, rawParts: next },
    kept: Object.keys(next).length,
    pruned,
  };
}
