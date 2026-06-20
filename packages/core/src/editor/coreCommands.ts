/**
 * Commands the Editor owns directly — history undo/redo and the mark
 * toggles (bold / italic / …).
 *
 * These live in core, NOT the keyboard plugin, so a headless caller
 * (agent, MCP, a toolbar mounted without keyboard) and the browser's
 * Cmd+Z dispatch through the same command bus. The keyboard plugin only
 * maps keystrokes onto `execute(...)`.
 */

import type { History } from "../history";
import { MARK_COMMAND_DEFS, isMarkActive, rangeAtSelection, toggleMark } from "../plugins/marks";
import type { CommandBus, EditorLike } from "./types";

/**
 * Register history + mark commands on the bus. `editor` is the
 * structural {@link EditorLike} the mark helpers operate on — typing it
 * that way (not the concrete `Editor` from ./index) keeps this module a
 * leaf and avoids an index ↔ coreCommands import cycle.
 */
export function registerCoreCommands(
  commands: CommandBus,
  editor: EditorLike,
  history: History,
): void {
  commands.register({
    name: "history.undo",
    title: "Undo",
    run: () => {
      history.undo();
    },
    isActive: () => false,
    isAvailable: () => history.canUndo(),
  });
  commands.register({
    name: "history.redo",
    title: "Redo",
    run: () => {
      history.redo();
    },
    isActive: () => false,
    isAvailable: () => history.canRedo(),
  });

  for (const { name, title, tag } of MARK_COMMAND_DEFS) {
    commands.register({
      name,
      title,
      run: () => {
        // Caret in an editable textbox frame → apply natively there; the
        // body-selection path below can't address frame coordinates.
        if (editor.applyFrameMark?.(tag)) return;
        const range = rangeAtSelection(editor);
        if (range) toggleMark(editor, range, tag);
      },
      isActive: () => {
        const inFrame = editor.frameMarkActive?.(tag);
        if (inFrame !== null && inFrame !== undefined) return inFrame;
        const range = rangeAtSelection(editor);
        return !!range && isMarkActive(editor, range, tag);
      },
      isAvailable: () => editor.getBlocks().length > 0,
    });
  }
}
