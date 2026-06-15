import type { SectionBreak } from "../doc/types";
import type { Editor } from "../editor";

/**
 * Section commands plugin.
 *
 * Registers `section.insertBreakAfter` — inserts a `SectionBreak` block
 * after the caret's current block. The new section inherits the
 * previous section's properties (cloned so later edits don't bleed
 * back) so visual continuity is preserved until the user edits the
 * new section in Page Setup.
 *
 * The keyboard plugin's Ctrl+Shift+Enter dispatches this command, the
 * change-type popover does too, and a future Insert menu would as well
 * — same dispatch path for every trigger.
 */
export function attachSections(editor: Editor): () => void {
  return editor.commands.register({
    name: "section.insertBreakAfter",
    title: "Insert section break",
    isAvailable: () => editor.selection.currentCaret() !== null,
    run: () => insertSectionBreakAfterCaret(editor),
  });
}

function insertSectionBreakAfterCaret(editor: Editor): void {
  const caret = editor.selection.currentCaret();
  if (!caret) return;
  const block: SectionBreak = {
    kind: "section_break",
    // `toSectionIndex` is the position of the new (next) section. Set
    // to current sections length — Sobree's `change` listener picks up
    // the new section index by re-walking the body and rebuilding its
    // local sections view; we don't enforce the exact value here.
    toSectionIndex: editor.getDocument().sections.length,
  };
  const result = editor.insertBlockAfter(caret.block, block);
  if (!result.ok) {
    console.warn("[sobree] section.insertBreakAfter failed:", result.error);
    return;
  }
  // Clone the previous section's properties for the new one so the
  // visual layout stays the same until the user edits Page Setup. The
  // doc model has a sections array; mirror it.
  const doc = editor.getDocument();
  const sections = doc.sections.slice();
  const lastIdx = sections.length - 1;
  const lastSection = sections[lastIdx];
  if (lastSection) {
    sections.push(structuredClone(lastSection));
    editor.setDocument({ ...doc, sections });
  }
}
