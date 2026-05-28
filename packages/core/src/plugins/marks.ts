import type { Range as ApiRange, BlockRef } from "../doc/api";
import { sliceRuns } from "../doc/runs";
import type { InlineRun, RunProperties } from "../doc/types";
import type { Editor, WrapTag } from "../editor";

/**
 * Mark toggle helpers — shared by the floating toolbar's mark buttons
 * and the keyboard plugin (Ctrl+B / I / U / …).
 *
 * "Mark" = a boolean / enum run property that maps 1:1 to a `wrapRange`
 * tag: `strong`, `em`, `u`, `s`, `sup`, `sub`. (`mark`/highlight is
 * passthrough — not a toggle, since highlight is colour-valued.)
 */

/** Tag → run property key for toggle detection. */
export const MARK_PROP: Record<string, keyof RunProperties> = {
  strong: "bold",
  em: "italic",
  u: "underline",
  s: "strike",
  sup: "verticalAlign",
  sub: "verticalAlign",
};

/** Expected "on" value for each mark. */
export const MARK_ON: Record<string, RunProperties[keyof RunProperties]> = {
  strong: true,
  em: true,
  u: "single",
  s: true,
  sup: "superscript",
  sub: "subscript",
};

export type ToggleableMark = "strong" | "em" | "u" | "s" | "sup" | "sub";

/**
 * Standard mark commands registered on every Editor's command bus.
 * Owned by the marks module so a single source of truth backs the
 * keyboard plugin (`@sobree/keyboard`), the floating toolbar
 * (`@sobree/block-tools`), and any custom UI / agent dispatch.
 */
export interface MarkCommandDef {
  name: string;
  title: string;
  tag: ToggleableMark;
}

export const MARK_COMMAND_DEFS: readonly MarkCommandDef[] = [
  { name: "mark.toggle.bold", title: "Bold", tag: "strong" },
  { name: "mark.toggle.italic", title: "Italic", tag: "em" },
  { name: "mark.toggle.underline", title: "Underline", tag: "u" },
  { name: "mark.toggle.strike", title: "Strikethrough", tag: "s" },
  { name: "mark.toggle.superscript", title: "Superscript", tag: "sup" },
  { name: "mark.toggle.subscript", title: "Subscript", tag: "sub" },
];

/**
 * Apply or clear a mark across `range` based on its current state. If
 * every text run in the range already carries the mark's "on" value,
 * the call clears it; otherwise the mark is applied.
 *
 * `mark` (highlight) is delegated straight to `wrapRange` — it's not a
 * toggle since highlight is a colour, not a boolean.
 */
export function toggleMark(
  editor: Editor,
  range: ApiRange,
  tag: WrapTag,
): void {
  if (tag === "mark") {
    editor.wrapRange(range, tag);
    return;
  }
  if (isMarkActive(editor, range, tag)) {
    const prop = MARK_PROP[tag];
    if (!prop) return;
    editor.applyRunProperties(range, { [prop]: undefined } as never);
  } else {
    editor.wrapRange(range, tag);
  }
}

/**
 * True when every non-empty text run inside `range` has the mark's "on"
 * value. Walks hyperlink children. Multi-block ranges always read as
 * inactive so a click sets the mark before clearing it.
 */
export function isMarkActive(editor: Editor, range: ApiRange, tag: string): boolean {
  const prop = MARK_PROP[tag];
  const onValue = MARK_ON[tag];
  if (!prop) return false;
  if (range.from.block.id !== range.to.block.id) return false;
  const info = editor.getBlockById(range.from.block.id);
  if (!info || info.kind !== "paragraph") return false;
  const doc = editor.getDocument();
  const block = doc.body[info.index];
  if (!block || block.kind !== "paragraph") return false;
  const from = range.from.offset;
  const to = range.to.offset;
  const runs = from === to ? block.runs : sliceRuns(block.runs, from, to);
  if (runs.length === 0) return false;
  return everyTextRunHas(runs, prop, onValue);
}

function everyTextRunHas(
  runs: readonly InlineRun[],
  prop: keyof RunProperties,
  onValue: unknown,
): boolean {
  let sawText = false;
  for (const r of runs) {
    if (r.kind === "text") {
      if (r.text.length === 0) continue;
      sawText = true;
      const v = (r.properties as Record<string, unknown>)[prop];
      if (v !== onValue) return false;
    } else if (r.kind === "hyperlink") {
      if (!everyTextRunHas(r.children, prop, onValue)) return false;
      sawText = true;
    }
    // Other kinds (drawing, break) don't carry run properties — ignore.
  }
  return sawText;
}

/**
 * Pick the right range to operate on: live DOM selection if any,
 * otherwise the full extent of the block at the caret. Matches the
 * "press Ctrl+B with caret only → bold the whole paragraph" UX.
 */
export function rangeAtSelection(editor: Editor): ApiRange | null {
  const sel = editor.selection.currentRange();
  if (sel) return sel;
  const caret = editor.selection.currentCaret();
  let block: BlockRef | null = caret?.block ?? null;
  if (!block) {
    const first = editor.getBlocks()[0];
    if (first) block = { id: first.id, version: first.version };
  }
  if (!block) return null;
  const info = editor.getBlockById(block.id);
  const length = info?.length ?? 0;
  return {
    from: { block, offset: 0 },
    to: { block, offset: length },
  };
}
