import type { BlockTarget } from "../blockKinds";
import { MARK_ON, MARK_PROP, toggleMark } from "@sobree/core";
import { icon } from "./icons";
import type { Range as ApiRange, BlockRef, RunProperties } from "@sobree/core";
import type { Editor } from "@sobree/core";
import { readSelectionState } from "./selectionState";

export interface ToolContext {
  editor: Editor;
  target: BlockTarget;
}

/**
 * Text-formatting tools shown on every block type. Returns an HTML
 * string for the toolbar shell to inject, plus a wiring function that
 * installs click/input listeners against it.
 */
export function buildTextToolsHtml(): string {
  return `
    <div class="tb-group" data-group="text">
      <select data-role="font-family" aria-label="Font family" title="Font family">
        <option value="">Font</option>
        <option>Arial</option>
        <option>Calibri</option>
        <option>Cambria</option>
        <option>Consolas</option>
        <option>Courier New</option>
        <option>Georgia</option>
        <option>Helvetica</option>
        <option>Times New Roman</option>
        <option>Verdana</option>
      </select>
      <select data-role="font-size" aria-label="Font size" title="Font size">
        <option value="">Size</option>
        ${[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72].map((n) => `<option>${n}</option>`).join("")}
      </select>
    </div>
    <div class="tb-divider"></div>
    <div class="tb-group" data-group="marks" role="group" aria-label="Text formatting">
      <button type="button" data-action="wrap" data-tag="strong" title="Bold (Ctrl+B)" aria-label="Bold" aria-pressed="false">${icon("bold")}</button>
      <button type="button" data-action="wrap" data-tag="em" title="Italic (Ctrl+I)" aria-label="Italic" aria-pressed="false">${icon("italic")}</button>
      <button type="button" data-action="wrap" data-tag="u" title="Underline (Ctrl+U)" aria-label="Underline" aria-pressed="false">${icon("underline")}</button>
      <button type="button" data-action="wrap" data-tag="s" title="Strikethrough" aria-label="Strikethrough" aria-pressed="false">${icon("strike")}</button>
      <button type="button" data-action="wrap" data-tag="sup" title="Superscript" aria-label="Superscript" aria-pressed="false">${icon("superscript")}</button>
      <button type="button" data-action="wrap" data-tag="sub" title="Subscript" aria-label="Subscript" aria-pressed="false">${icon("subscript")}</button>
    </div>
    <div class="tb-divider"></div>
    <div class="tb-group" data-group="colour" role="group" aria-label="Colour and highlight">
      <label class="tb-colour" title="Text colour">
        ${icon("paintbrush")}
        <input type="color" data-role="color" value="#c96f22" aria-label="Text colour" />
      </label>
      <label class="tb-colour" title="Highlight">
        ${icon("highlighter")}
        <input type="color" data-role="highlight" value="#fff3a1" aria-label="Highlight colour" />
      </label>
      <button type="button" data-action="clear-formatting" title="Clear formatting" aria-label="Clear formatting">${icon("eraser")}</button>
    </div>
  `;
}

/** Install click + input listeners for the text tool block. */
export function wireTextTools(
  root: HTMLElement,
  ctx: ToolContext,
): () => void {
  const onClick = (e: Event) => {
    const btn = (e.target as HTMLElement).closest("button[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    if (action === "wrap") {
      const tag = btn.getAttribute("data-tag") as
        | "strong"
        | "em"
        | "u"
        | "s"
        | "sup"
        | "sub"
        | "mark"
        | null;
      if (!tag) return;
      const range = rangeForContext(ctx);
      toggleMark(ctx.editor, range, tag);
      // Sync visual state immediately — the editor's change event is
      // debounced, so wait for the next tick to re-check the AST.
      requestAnimationFrame(() => syncActive(root, ctx));
      return;
    }
    if (action === "clear-formatting") {
      ctx.editor.clearInlineFormattingAtSelection();
      requestAnimationFrame(() => syncActive(root, ctx));
      return;
    }
  };

  const onInput = (e: Event) => {
    const el = e.target as HTMLElement;
    const role = el.getAttribute("data-role");
    if (!role) return;
    const range = rangeForContext(ctx);
    if (role === "font-family") {
      const v = (el as HTMLSelectElement).value;
      // No reset — the syncActive() pass on the next selection/change
      // event puts the select back in sync with the actual run state.
      if (v) ctx.editor.applyRunProperties(range, { fontFamily: v });
      return;
    }
    if (role === "font-size") {
      const v = Number((el as HTMLSelectElement).value);
      if (Number.isFinite(v) && v > 0) {
        ctx.editor.applyRunProperties(range, { fontSizePt: v });
      }
      return;
    }
    if (role === "color") {
      ctx.editor.applyRunProperties(range, {
        color: (el as HTMLInputElement).value,
      });
      return;
    }
    if (role === "highlight") {
      ctx.editor.applyRunProperties(range, {
        highlight: (el as HTMLInputElement).value,
      });
      return;
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  // Selection- and change-driven sync. Subscribe through the editor so
  // we share its single document-level listener (instead of every text
  // tools instance attaching its own `selectionchange` handler). Both
  // events: `selection` for moving the caret, `change` for edits that
  // alter the AST (e.g. apply bold from a keyboard shortcut).
  const sync = () => syncActive(root, ctx);
  const detachSelection = ctx.editor.on("selection", sync);
  const detachChange = ctx.editor.on("change", sync);

  // Initial sync — reflect the caret's current formatting when the
  // toolbar opens.
  sync();

  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
    root.removeEventListener("change", onInput);
    detachSelection();
    detachChange();
  };
}

/**
 * Repaint mark pressed-state and font / colour input values to reflect
 * the current selection. Call from `selection` + `change` events.
 *
 * Mark buttons read from the cascade-resolved `state.runProps` so a
 * caret in an H1 (whose style defaults `bold: true`) shows Bold as
 * pressed, even if the run itself has no explicit `bold` override.
 */
function syncActive(root: HTMLElement, ctx: ToolContext): void {
  const state = readSelectionState(ctx.editor);
  const btns = root.querySelectorAll<HTMLButtonElement>(
    'button[data-action="wrap"][data-tag]',
  );
  for (const btn of btns) {
    const tag = btn.getAttribute("data-tag");
    if (!tag || tag === "mark") continue;
    const prop = MARK_PROP[tag];
    const expected = MARK_ON[tag];
    const on = prop !== undefined && (state.runProps as RunProperties)[prop] === expected;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("is-active", on);
  }

  // Font / colour inputs reflect the run-level state at the caret.
  // For mixed selections, dropdowns go to their placeholder ("Font" /
  // "Size") and colour inputs hold their last-set value (no native
  // way to render "indeterminate" on <input type=color>).
  const fontFamily = root.querySelector<HTMLSelectElement>(
    'select[data-role="font-family"]',
  );
  if (fontFamily) {
    const v = state.runProps.fontFamily ?? "";
    fontFamily.value = optionMatch(fontFamily, v) ? v : "";
  }
  const fontSize = root.querySelector<HTMLSelectElement>(
    'select[data-role="font-size"]',
  );
  if (fontSize) {
    const sz = state.runProps.fontSizePt;
    const v = sz === undefined ? "" : String(sz);
    fontSize.value = optionMatch(fontSize, v) ? v : "";
  }
  const color = root.querySelector<HTMLInputElement>(
    'input[data-role="color"]',
  );
  if (color && state.runProps.color) color.value = state.runProps.color;
  const highlight = root.querySelector<HTMLInputElement>(
    'input[data-role="highlight"]',
  );
  if (highlight && state.runProps.highlight) {
    highlight.value = state.runProps.highlight;
  }
}

function optionMatch(sel: HTMLSelectElement, value: string): boolean {
  for (const opt of Array.from(sel.options)) {
    if (opt.value === value) return true;
  }
  return false;
}

/**
 * Use the live DOM selection if one exists; otherwise fall back to a
 * range covering the whole target block. Matches the "click Bold with
 * caret only → bold the whole paragraph" UX.
 */
function rangeForContext(ctx: ToolContext): ApiRange {
  const sel = ctx.editor.selection.currentRange();
  if (sel) return sel;
  return rangeForBlock(ctx.editor, ctx.target);
}

function rangeForBlock(editor: Editor, _target: BlockTarget): ApiRange {
  // Pragmatic: use the current selection's block ref as the anchor —
  // clicking the indicator has already placed the caret inside the
  // target block, so the caret's block ref is the right one. Fall back
  // to the first body block if selection is somehow missing.
  const caret = editor.selection.currentCaret();
  const block: BlockRef = caret?.block ?? editor.getBlocks()[0]!;
  const info = editor.getBlockById(block.id);
  const length = info?.length ?? 0;
  return {
    from: { block, offset: 0 },
    to: { block, offset: length },
  };
}
