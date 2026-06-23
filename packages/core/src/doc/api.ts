/**
 * API-level types for talking to the Editor.
 *
 * These describe HOW you address content (positions, ranges, selections)
 * and what guarantees you get back (block versions, edit results). They
 * are JSON-clean so the same shapes work for in-process callers, the
 * forthcoming WebSocket / MCP adapter, and tests.
 *
 * Kept separate from `src/doc/types.ts` (the AST itself) because these
 * are runtime concerns — none of them are persisted to .docx.
 *
 * Design note on why there's no polymorphic `Position` type:
 *   - For block-scoped operations (insert / replace / delete) the input
 *     is a `BlockRef` paired with a method name that spells out the
 *     intent (`insertBlockBefore`, `insertBlockAfter`).
 *   - For inline-scoped operations (insert a run, move caret, apply
 *     attributes across a span) the input is an `InlinePosition` — a
 *     block ref plus a character offset inside that block.
 *   This keeps method signatures self-describing for LLM / MCP callers,
 *   no discriminated unions to construct.
 */

// === block identity & versioning ===

/**
 * Stable handle to a block, valid for the lifetime of an Editor instance.
 * `id` is allocated by the Editor on first sight (sequential strings like
 * `"b1"`, `"b2"`); `version` bumps on every modification. Versions reset
 * to 0 when the document is reloaded (`setDocument`, `openDocx`).
 *
 * Pass this to mutating operations to opt in to optimistic locking. The
 * operation fails with `"optimistic-lock"` if the live version no longer
 * matches.
 */
export interface BlockRef {
  id: string;
  version: number;
}

/** Version map for blocks an operation should also lock-check. */
export type BlockExpectations = Record<string, number>;

// === positions ===

/**
 * Address a point inside a block's content.
 *
 * `offset = 0` is the start of the block's content; `offset = blockLength`
 * is the end. Non-text inlines (drawings, fields, hyperlinks) count as
 * 1 each. A caret always lives inside a block — "before block N" is
 * expressed as `{ block: blockN, offset: 0 }`; "after block N" is
 * `{ block: blockN, offset: blockLength }`. For inserting NEW blocks
 * adjacent to an existing one, use the `insertBlockBefore` /
 * `insertBlockAfter` methods directly — they take a `BlockRef`, not a
 * position.
 */
export interface InlinePosition {
  block: BlockRef;
  offset: number;
  /**
   * Set when the position is inside a table cell: the rendered cell address
   * the `offset` is measured within — `row` (the cell's `<tr>` index in the
   * table), `col` (its cell index in that row), `blockIndex` (which content
   * block inside the cell). Absent for ordinary block positions, where
   * `offset` is the character offset into `block` itself. Lets caret capture
   * / restore (e.g. undo) land back in the same cell instead of collapsing to
   * the table boundary.
   */
  cell?: { row: number; col: number; blockIndex: number };
}

/**
 * Inclusive range from `from` to `to` — both inline positions. Single-
 * block ranges have `from.block.id === to.block.id`.
 *
 * For operations that span blocks, pass `opts.expect` with the middle
 * blocks' expected versions — the Range itself only pins the endpoints.
 */
export interface Range {
  from: InlinePosition;
  to: InlinePosition;
}

/**
 * The current cursor / selection state of the editor in model terms.
 * `null` when nothing is selected (e.g. focus is outside the editor).
 */
export type Selection =
  | null
  | { kind: "caret"; at: InlinePosition }
  | { kind: "range"; range: Range };

// === edit results ===

/** Result envelope returned by every mutating operation. */
export type EditResult<T = void> =
  | { ok: true; value: T; affected: BlockRef[] }
  | { ok: false; error: EditError };

/** Why an edit didn't apply. Discriminated union — agents switch on `code`. */
export type EditError =
  | OptimisticLockError
  | { code: "invalid-position"; details: string }
  | { code: "unknown-block"; blockId: string }
  | { code: "range-empty"; details: string }
  | { code: "range-out-of-order"; details: string }
  | { code: "invalid-state"; details: string };

export interface OptimisticLockError {
  code: "optimistic-lock";
  /**
   * Per-block conflict info. `actual` is `null` when the block has been
   * deleted between read and write — distinguishable from a stale
   * version on the same block.
   */
  conflicts: Array<{
    blockId: string;
    expected: number;
    actual: number | null;
  }>;
}

// === helpers (pure data — usable from anywhere) ===

/** Build an inline position inside `block` at the given character offset. */
export function inlineAt(block: BlockRef, offset: number): InlinePosition {
  return { block, offset };
}

/** Construct a range from two positions. */
export function makeRange(from: InlinePosition, to: InlinePosition): Range {
  return { from, to };
}

/** Caret at a single position. */
export function caretAt(at: InlinePosition): Selection {
  return { kind: "caret", at };
}

/** True if two inline positions are inside the same block (by id). */
export function sameBlock(a: InlinePosition, b: InlinePosition): boolean {
  return a.block.id === b.block.id;
}

/** Zero-width range — `from` and `to` collapsed onto the same offset. */
export function isCollapsedRange(range: Range): boolean {
  return sameBlock(range.from, range.to) && range.from.offset === range.to.offset;
}

/** Caret selection OR collapsed range. */
export function isCaret(sel: Selection): boolean {
  if (!sel) return false;
  if (sel.kind === "caret") return true;
  return isCollapsedRange(sel.range);
}

/** Build an `EditResult` for a successful operation. */
export function ok<T>(value: T, affected: BlockRef[] = []): EditResult<T> {
  return { ok: true, value, affected };
}

/** Build an `EditResult` for a failed operation. */
export function fail(error: EditError): EditResult<never> {
  return { ok: false, error };
}

/** Specialised builder for the common optimistic-lock failure case. */
export function lockConflict(conflicts: OptimisticLockError["conflicts"]): EditResult<never> {
  return fail({ code: "optimistic-lock", conflicts });
}
