import type { Range as ApiRange, BlockRef, InlinePosition, Selection } from "../doc/api";
import type { BlockRegistry } from "./internal/blockRegistry";
import { applySelectionToDom, selectionFromDom } from "./internal/positionMap";

/**
 * The slice of Editor internals `EditorSelection` reads — its
 * decoupling seam, so this module doesn't import the concrete `Editor`
 * class (which would re-introduce an import cycle). The `Editor`
 * structurally satisfies it via its `_hosts()` / `_registry()`
 * accessors.
 */
export interface SelectionHost {
  _hosts(): HTMLElement[];
  _registry(): BlockRegistry;
}

/**
 * Model-level view of the editor's live DOM selection. `editor.selection`
 * is an instance of this; it translates between the browser selection
 * and Sobree's `Selection` / `Range` / `InlinePosition` shapes.
 */
export class EditorSelection {
  constructor(private readonly editor: SelectionHost) {}

  /** Current selection as a model `Selection`. Returns `null` when focus is outside. */
  get(): Selection {
    return selectionFromDom(this.editor._hosts(), this.editor._registry());
  }

  /** Apply a model selection to the DOM. */
  set(sel: Selection): boolean {
    return applySelectionToDom(this.editor._hosts(), this.editor._registry(), sel);
  }

  /** Shortcut: current selection as a `Range`, or `null` when collapsed/absent. */
  currentRange(): ApiRange | null {
    const s = this.get();
    if (!s) return null;
    if (s.kind === "caret") return null;
    return s.range;
  }

  /** Shortcut: the caret position (collapses a range to its `from`). */
  currentCaret(): InlinePosition | null {
    const s = this.get();
    if (!s) return null;
    if (s.kind === "caret") return s.at;
    return s.range.from;
  }

  /** Shortcut: ref of the block containing the caret. */
  currentBlock(): BlockRef | null {
    const c = this.currentCaret();
    return c ? c.block : null;
  }

  /** Legacy: current block index (for code still using indices). */
  currentBlockIndex(): number | null {
    const b = this.currentBlock();
    if (!b) return null;
    return this.editor._registry().indexOf(b.id);
  }
}
