/**
 * DOM event wiring for the Editor.
 *
 * The Editor needs a fixed set of `host` / `document` listeners —
 * input, beforeinput, IME composition, selectionchange, keydown, paste,
 * drag/drop — plus the image-resize handles and a remote-Y.Doc-update
 * subscription. Keeping them here (out of the constructor) does two
 * things: it drops the constructor's length and nesting, and it makes
 * teardown a single returned function instead of seven nullable fields
 * the destructor has to remember to clear.
 *
 * `wireEditorDom` takes the small set of editor hooks the listeners
 * actually call and returns one teardown that removes everything.
 */

import type * as Y from "yjs";
import type { History } from "../history";
import type { EditorContext } from "./context";
import * as runs from "./ops/runs";
import type { TrackedInput } from "./ops/trackedInput";
import { attachImageResize } from "./view/imageResize";

export interface EditorDomHooks {
  host: HTMLElement;
  ctx: EditorContext;
  ydoc: Y.Doc;
  history: History;
  trackedInput: TrackedInput;
  /** Tracked-changes authoring mode is on right now. */
  isTrackedEnabled: () => boolean;
  /** A real edit is about to mutate the DOM (`beforeinput`, before the
   *  mutation). Lets the editor stash the pre-edit selection for undo. */
  onBeforeInput: () => void;
  /** Mark the DOM dirty + schedule a debounced change. */
  onInput: () => void;
  /** Fire the editor's `selection` event. */
  fireSelection: () => void;
  /** Fire the editor's `keydown` event. */
  fireKeyDown: (e: KeyboardEvent) => void;
  /** Re-project + re-render after a remote Y.Doc update. */
  adoptYDocState: () => void;
}

/**
 * Attach every DOM/document listener the editor relies on and return a
 * teardown that removes them all (listeners, image-resize handles, and
 * the Y.Doc subscription). Idempotent teardown — safe to call once.
 */
export function wireEditorDom(hooks: EditorDomHooks): () => void {
  const { host } = hooks;
  const cleanups: Array<() => void> = [];
  const listen = (target: EventTarget, type: string, handler: EventListener): void => {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };

  // input → debounced sync. Y.UndoManager observes the resulting Y ops
  // and coalesces stack items (typing within ~1s = one undo step).
  listen(host, "input", () => hooks.onInput());

  // beforeinput is the only hook to intercept the browser's native
  // contentEditable undo/redo and route them through our history layer,
  // and to take over tracked-changes authoring before the browser
  // mutates the DOM.
  listen(host, "beforeinput", (e) => {
    const ie = e as InputEvent;
    if (ie.inputType === "historyUndo") {
      e.preventDefault();
      hooks.history.undo();
      return;
    }
    if (ie.inputType === "historyRedo") {
      e.preventDefault();
      hooks.history.redo();
      return;
    }
    // A genuine edit is about to mutate the DOM — stash the pre-edit
    // selection so undo can land the caret where the edit began. Done
    // before the tracked-changes interception below, which may rewrite or
    // cancel the native mutation but doesn't change where it started.
    hooks.onBeforeInput();
    // Tracked path: convert the edits we understand into typed
    // `insertRun` / `deleteRange` so the runs carry revision markers.
    // We also take over when tracked mode is OFF but the caret sits in a
    // leftover `<ins>`/`<del>` wrapper — otherwise the browser inserts
    // INSIDE the wrapper and `syncFromDom` would wrongly stamp the new
    // run as a revision the user opted out of. Unhandled inputTypes fall
    // through to native contentEditable.
    const inTracked = hooks.isTrackedEnabled();
    const inRevisionWrapper = !inTracked && hooks.trackedInput.caretInsideRevisionWrapper();
    if ((inTracked || inRevisionWrapper) && hooks.trackedInput.handleBeforeInput(ie)) {
      e.preventDefault();
    }
  });

  // IME composition — the trackedInput module holds the snapshot; the
  // listeners are unconditional but only do work when tracked mode was
  // on at compositionstart.
  listen(host, "compositionstart", (e) =>
    hooks.trackedInput.handleCompositionStart(e as CompositionEvent),
  );
  listen(host, "compositionend", (e) =>
    hooks.trackedInput.handleCompositionEnd(e as CompositionEvent),
  );

  // One global selectionchange funnels all cursor movement into the
  // editor's `selection` event so plugins subscribe to the editor, not
  // the document.
  listen(document, "selectionchange", () => hooks.fireSelection());

  // Host keydown → the editor's `keydown` event. The editor binds no
  // shortcuts itself.
  listen(host, "keydown", (e) => hooks.fireKeyDown(e as KeyboardEvent));

  listen(host, "paste", (e) => void hooks.trackedInput.onPaste(e as ClipboardEvent));
  listen(host, "dragover", (e) => runs.onDragOver(hooks.ctx, e as DragEvent));
  listen(host, "drop", (e) => void runs.onDrop(hooks.ctx, e as DragEvent));

  const detachImageResize = attachImageResize(host);
  cleanups.push(detachImageResize);

  // Remote-origin Y.Doc updates (a provider applied them) re-project +
  // re-render. Local mutations (origin "local") and the seed pass
  // (origin "seed") are already reflected in the AST, so skip them.
  const onAfterTransaction = (tr: Y.Transaction): void => {
    if (tr.origin === "local" || tr.origin === "seed") return;
    hooks.adoptYDocState();
  };
  hooks.ydoc.on("afterTransaction", onAfterTransaction);
  cleanups.push(() => hooks.ydoc.off("afterTransaction", onAfterTransaction));

  return () => {
    for (const cleanup of cleanups) cleanup();
    hooks.trackedInput.reset();
  };
}
