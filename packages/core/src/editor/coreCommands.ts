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
import type { Editor } from "./index";

/** Register history + mark commands on `editor.commands`. */
export function registerCoreCommands(editor: Editor, history: History): void {
  editor.commands.register({
    name: "history.undo",
    title: "Undo",
    run: () => {
      history.undo();
    },
    isActive: () => false,
    isAvailable: () => history.canUndo(),
  });
  editor.commands.register({
    name: "history.redo",
    title: "Redo",
    run: () => {
      history.redo();
    },
    isActive: () => false,
    isAvailable: () => history.canRedo(),
  });

  for (const { name, title, tag } of MARK_COMMAND_DEFS) {
    editor.commands.register({
      name,
      title,
      run: () => {
        const range = rangeAtSelection(editor);
        if (range) toggleMark(editor, range, tag);
      },
      isActive: () => {
        const range = rangeAtSelection(editor);
        return !!range && isMarkActive(editor, range, tag);
      },
      isAvailable: () => editor.getBlocks().length > 0,
    });
  }
}
