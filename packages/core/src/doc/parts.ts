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

import { fontLivenessPaths } from "../fonts/liveness";
import type { AnchoredFrame, Block, InlineRun, SobreeDocument } from "./types";
import { walkBlock } from "./walk";

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

  // Floating layers reference media too: a frame can be a picture, or a
  // textbox/group that nests pictures. Body and header/footer frames are
  // walked the same way — without this, an anchored picture's bytes would
  // be pruned out on export despite the frame still pointing at them.
  for (const frame of doc.anchoredFrames ?? []) collectFromFrame(frame, live);
  for (const frames of Object.values(doc.headerFooterFrames ?? {})) {
    for (const frame of frames) collectFromFrame(frame, live);
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

/** Add every `rawParts` key an anchored frame points at — directly (a
 *  picture's `partPath`), via its textbox body, or via nested group
 *  children. Mirrors `collectFromBlock` for the floating layer. */
function collectFromFrame(frame: AnchoredFrame, live: Set<string>): void {
  const c = frame.content;
  switch (c.kind) {
    case "picture":
      live.add(c.partPath);
      return;
    case "textbox":
      for (const block of c.body) collectFromBlock(block, live);
      return;
    case "group":
      for (const child of c.children) collectFromFrame(child, live);
      return;
    case "shape":
      return;
  }
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
