/**
 * `@sobree/keyboard` — default keyboard shortcuts plugin.
 *
 * Registers no commands of its own. Subscribes to `editor.on("keydown",
 * …)` and dispatches the standard combos through the command bus —
 * `mark.toggle.bold` for Ctrl/Cmd+B, `history.undo` for Cmd+Z, and so
 * on. Every command this plugin invokes is registered by the Editor
 * core itself.
 *
 * Recommended usage — pass the `keyboard()` factory to
 * `createSobree({ plugins: [...] })`. For custom Editor mounts that
 * skip the factory, use `attachKeyboard(editor, opts?)` directly.
 */

import type { Editor, KeyDownPayload, SobreePlugin } from "@sobree/core";

export interface KeyboardOptions {
  /**
   * Extra key→command mappings to add on top of the defaults. Last
   * matcher wins on conflict — pass your own to override a default.
   */
  bindings?: KeyBinding[];
}

/**
 * One key binding: a predicate over the editor's `KeyDownPayload`
 * plus the command name to dispatch when it matches. The predicate
 * is called for every keydown — keep it cheap (modifier checks +
 * `e.key` switch).
 */
export interface KeyBinding {
  match: (e: KeyDownPayload) => boolean;
  command: string;
}

/**
 * `SobreePlugin` factory — the recommended way to mount this. Hand
 * the result to `createSobree({ plugins: [...] })` and `createSobree`
 * wires up setup + destroy automatically.
 *
 * ```ts
 * import { keyboard } from "@sobree/keyboard";
 * createSobree("#editor", { plugins: [keyboard()] });
 * // or with custom bindings layered on top of the defaults:
 * createSobree("#editor", { plugins: [keyboard({ bindings: [...] })] });
 * ```
 */
export function keyboard(opts?: KeyboardOptions): SobreePlugin {
  return {
    name: "keyboard",
    setup({ editor }) {
      const detach = attachKeyboard(editor, opts);
      return { destroy: detach };
    },
  };
}

/**
 * Lower-level: mount the keyboard handler directly on an Editor.
 * Useful when you've skipped `createSobree()` and instantiated
 * `Sobree` / `Editor` yourself. Returns an unsubscribe.
 *
 * ```ts
 * import { Sobree } from "@sobree/core";
 * import { attachKeyboard } from "@sobree/keyboard";
 * const sobree = new Sobree(host);
 * const detach = attachKeyboard(sobree.editor);
 * ```
 */
export function attachKeyboard(editor: Editor, opts: KeyboardOptions = {}): () => void {
  const all = [...DEFAULT_BINDINGS, ...(opts.bindings ?? [])];
  return editor.on("keydown", (e) => {
    // Reverse order so user-supplied overrides shadow defaults.
    for (let i = all.length - 1; i >= 0; i--) {
      const b = all[i]!;
      if (b.match(e)) {
        e.preventDefault();
        e.stopPropagation();
        editor.commands.execute(b.command);
        return;
      }
    }
  });
}

/**
 * Default keystroke → command mappings shipped with the plugin.
 * Exported so embedders extending the bindings can spread them in.
 */
export const DEFAULT_BINDINGS: readonly KeyBinding[] = [
  // Section break — Word uses Ctrl/Cmd+Shift+Enter for the same op.
  {
    match: (e) => cmd(e) && e.shift && !e.alt && (e.key === "Enter" || e.code === "Enter"),
    command: "section.insertBreakAfter",
  },
  // Undo / Redo. Cmd+Z is undo on every platform; Cmd+Shift+Z is the
  // macOS-native redo combo, Cmd+Y is the Windows-native one. Bind
  // both so muscle memory works either way.
  {
    match: (e) => cmd(e) && !e.shift && !e.alt && (e.key === "z" || e.key === "Z"),
    command: "history.undo",
  },
  {
    match: (e) => cmd(e) && e.shift && !e.alt && (e.key === "z" || e.key === "Z"),
    command: "history.redo",
  },
  {
    match: (e) => cmd(e) && !e.shift && !e.alt && (e.key === "y" || e.key === "Y"),
    command: "history.redo",
  },
  // Marks — single-letter combos, no shift (except Strike).
  { match: plain("b"), command: "mark.toggle.bold" },
  { match: plain("i"), command: "mark.toggle.italic" },
  { match: plain("u"), command: "mark.toggle.underline" },
  { match: plain("."), command: "mark.toggle.superscript" },
  { match: plain(","), command: "mark.toggle.subscript" },
  {
    match: (e) => cmd(e) && e.shift && !e.alt && (e.key === "s" || e.key === "S"),
    command: "mark.toggle.strike",
  },
];

function cmd(e: KeyDownPayload): boolean {
  return e.ctrl || e.meta;
}

function plain(key: string): (e: KeyDownPayload) => boolean {
  return (e) => cmd(e) && !e.shift && !e.alt && e.key === key;
}
