/**
 * Compute the minimal Y.Text mutations to bring a Y.Text in sync with
 * a target delta.
 *
 * # Why minimal mutations matter
 *
 * Y.Text is a CRDT — every `insert` / `delete` / `format` becomes a
 * Yjs operation broadcast to peers. The smaller and more targeted the
 * operations, the less chance of conflicting with concurrent edits.
 *
 * Replacing the whole text on every change destroys CRDT semantics:
 * one peer's "delete-all-and-reinsert" wipes whatever the other peer
 * was simultaneously typing. The diff in this module is the
 * difference between "two peers can type in the same paragraph" and
 * "one peer always wins".
 *
 * # Algorithm
 *
 * Three paths in increasing generality:
 *
 *   1. **No-op** — current and target deltas are structurally identical.
 *      Skip entirely. Catches the (common) case where a higher-level
 *      mutation didn't actually change this paragraph.
 *
 *   2. **Format-only** — same length and same per-position content
 *      (chars or embeds), but at least one position has different
 *      attributes. Walk and call `format()` for each changed range.
 *      This is the case for "bold the selection" — the text content
 *      is unchanged, just the marks; using format() instead of
 *      delete+reinsert preserves CRDT for any concurrent typing
 *      inside the formatted range.
 *
 *   3. **Prefix/suffix replace** — find the longest common prefix and
 *      longest common suffix of cells, then `delete()` the differing
 *      middle of the old and `insert()` the differing middle of the
 *      new. This handles typing (insert at position N), deletion,
 *      paste, and any other content-changing edit. Concurrent edits
 *      OUTSIDE the changed range are preserved by Y.Text's CRDT.
 *
 * # Cells
 *
 * Both deltas are flattened to a `Cell[]` representation: one cell
 * per character (for string inserts) or per embed (for object inserts).
 * Cells carry the per-position attributes — Y.Text marks that
 * surround the chunk get duplicated onto each cell.
 *
 * This is allocation-heavy for long paragraphs but bounded by
 * paragraph length (rarely > 1000 chars). For Phase 1c we can switch
 * to a streaming diff.
 */

import type * as Y from "yjs";
import { type DeltaOp, deepEqual } from "./runs";

interface Cell {
  /** "char" or "embed" — embeds occupy 1 Y.Text position. */
  kind: "char" | "embed";
  /** For "char": the single character. For "embed": empty string. */
  char: string;
  /** For "embed": the embed object. For "char": null. */
  embed: object | null;
  /** Per-position attributes. Always an object (possibly empty). */
  attrs: Record<string, unknown>;
}

/**
 * Apply the difference between Y.Text's current state and `targetDelta`
 * as the minimal set of Y.Text mutations. Caller is responsible for
 * wrapping in `Y.Doc.transact` if it wants the changes batched into
 * one transaction with whatever else.
 */
export function diffApplyText(yText: Y.Text, targetDelta: readonly DeltaOp[]): void {
  const oldDelta = yText.toDelta() as DeltaOp[];
  const oldCells = flatten(oldDelta);
  const newCells = flatten(targetDelta);

  // Path 1: no-op.
  if (cellsEqual(oldCells, newCells)) return;

  // Path 2: format-only.
  if (
    oldCells.length === newCells.length &&
    oldCells.every((c, i) => contentEqual(c, newCells[i]!))
  ) {
    applyFormatOnly(yText, oldCells, newCells);
    return;
  }

  // Path 3: prefix/suffix replace.
  applyPrefixSuffixDiff(yText, oldCells, newCells);
}

// === flatten ===

function flatten(delta: readonly DeltaOp[]): Cell[] {
  const out: Cell[] = [];
  for (const op of delta) {
    const attrs = (op.attributes ?? {}) as Record<string, unknown>;
    if (typeof op.insert === "string") {
      // Iterate characters via spread to handle surrogate pairs as
      // single units. Y.Text positions count UTF-16 code units, so
      // emoji etc. occupy 2 positions; we still emit 2 cells (one per
      // code unit) to keep position math accurate.
      for (let i = 0; i < op.insert.length; i++) {
        out.push({
          kind: "char",
          char: op.insert.charAt(i),
          embed: null,
          attrs,
        });
      }
    } else if (op.insert && typeof op.insert === "object") {
      out.push({
        kind: "embed",
        char: "",
        embed: op.insert as object,
        attrs,
      });
    }
  }
  return out;
}

// === comparisons ===

function cellsEqual(a: readonly Cell[], b: readonly Cell[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!cellEqual(a[i]!, b[i]!)) return false;
  }
  return true;
}

function cellEqual(a: Cell, b: Cell): boolean {
  return contentEqual(a, b) && deepEqual(a.attrs, b.attrs);
}

function contentEqual(a: Cell, b: Cell): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "char") return a.char === b.char;
  return deepEqual(a.embed, b.embed);
}

// === path 2: format-only ===

function applyFormatOnly(
  yText: Y.Text,
  oldCells: readonly Cell[],
  newCells: readonly Cell[],
): void {
  // Walk; group consecutive positions with the same attribute delta
  // into one format() call.
  let i = 0;
  while (i < newCells.length) {
    const oldA = oldCells[i]!.attrs;
    const newA = newCells[i]!.attrs;
    if (deepEqual(oldA, newA)) {
      i++;
      continue;
    }
    // Compute the attr delta at this position.
    const delta = computeAttrDelta(oldA, newA);
    // Extend forward as long as the delta stays the same.
    let j = i + 1;
    while (j < newCells.length) {
      const dj = computeAttrDelta(oldCells[j]!.attrs, newCells[j]!.attrs);
      if (!deepEqual(delta, dj)) break;
      j++;
    }
    yText.format(i, j - i, delta);
    i = j;
  }
}

/**
 * Compute the delta to transform `oldAttrs` into `newAttrs`. Keys
 * present in oldAttrs but absent in newAttrs map to `null` (Y.Text's
 * convention for "remove this mark").
 */
function computeAttrDelta(
  oldAttrs: Record<string, unknown>,
  newAttrs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Set / change.
  for (const [k, v] of Object.entries(newAttrs)) {
    if (!deepEqual(oldAttrs[k], v)) out[k] = v;
  }
  // Remove.
  for (const k of Object.keys(oldAttrs)) {
    if (!(k in newAttrs)) out[k] = null;
  }
  return out;
}

// === path 3: prefix/suffix replace ===

function applyPrefixSuffixDiff(
  yText: Y.Text,
  oldCells: readonly Cell[],
  newCells: readonly Cell[],
): void {
  // Common prefix length.
  let prefix = 0;
  while (
    prefix < oldCells.length &&
    prefix < newCells.length &&
    cellEqual(oldCells[prefix]!, newCells[prefix]!)
  ) {
    prefix++;
  }
  // Common suffix length (don't cross into prefix).
  let suffix = 0;
  while (
    suffix < oldCells.length - prefix &&
    suffix < newCells.length - prefix &&
    cellEqual(
      oldCells[oldCells.length - 1 - suffix]!,
      newCells[newCells.length - 1 - suffix]!,
    )
  ) {
    suffix++;
  }

  const deleteLen = oldCells.length - prefix - suffix;
  if (deleteLen > 0) {
    yText.delete(prefix, deleteLen);
  }

  // Insert the new middle, grouping consecutive same-attribute char
  // cells into single Y.Text.insert calls.
  insertCellsAt(yText, prefix, newCells, prefix, newCells.length - suffix);

  // After delete + insert, the prefix and suffix regions are
  // unchanged on the Y.Text — their CRDT identity is preserved.
}

function insertCellsAt(
  yText: Y.Text,
  startPos: number,
  cells: readonly Cell[],
  start: number,
  end: number,
): void {
  let cursor = startPos;
  let i = start;
  while (i < end) {
    const cell = cells[i]!;
    if (cell.kind === "embed") {
      // y-text insertEmbed: 1 position, optional attributes.
      yText.insertEmbed(
        cursor,
        cell.embed as Record<string, unknown>,
        cell.attrs,
      );
      cursor++;
      i++;
      continue;
    }
    // Group consecutive char cells with identical attrs.
    let j = i + 1;
    while (j < end && cells[j]!.kind === "char" && deepEqual(cells[j]!.attrs, cell.attrs)) {
      j++;
    }
    const text = cellsToString(cells, i, j);
    yText.insert(cursor, text, cell.attrs);
    cursor += text.length;
    i = j;
  }
}

function cellsToString(cells: readonly Cell[], start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += cells[i]!.char;
  return out;
}
