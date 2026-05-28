/**
 * Tests focus on the key→command mapping. Command execution itself is
 * covered by the core editor tests; here we just verify the right
 * command name gets dispatched for each combo, and that user-supplied
 * bindings shadow the defaults.
 */
import { describe, expect, it, vi } from "vitest";
import type { Editor, KeyDownPayload } from "@sobree/core";
import { attachKeyboard, DEFAULT_BINDINGS } from "./index";

interface Stub {
  editor: Editor;
  fire: (combo: Partial<KeyDownPayload>) => void;
  executed: string[];
}

function makeStub(): Stub {
  const executed: string[] = [];
  const listeners: Array<(p: KeyDownPayload) => void> = [];
  const stubEditor = {
    on: (event: string, cb: (p: KeyDownPayload) => void) => {
      if (event !== "keydown") return () => {};
      listeners.push(cb);
      return () => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    commands: {
      execute: vi.fn((name: string) => {
        executed.push(name);
      }),
    },
  } as unknown as Editor;

  function fire(combo: Partial<KeyDownPayload>): void {
    const payload: KeyDownPayload = {
      key: "",
      code: "",
      ctrl: false,
      meta: false,
      shift: false,
      alt: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      originalEvent: new KeyboardEvent("keydown"),
      ...combo,
    };
    for (const l of listeners) l(payload);
  }

  return { editor: stubEditor, fire, executed };
}

describe("attachKeyboard — default bindings", () => {
  it("Cmd+Z dispatches history.undo", () => {
    const { editor, fire, executed } = makeStub();
    const off = attachKeyboard(editor);
    fire({ key: "z", meta: true });
    expect(executed).toEqual(["history.undo"]);
    off();
  });

  it("Cmd+Shift+Z dispatches history.redo", () => {
    const { editor, fire, executed } = makeStub();
    attachKeyboard(editor);
    fire({ key: "z", meta: true, shift: true });
    expect(executed).toEqual(["history.redo"]);
  });

  it("Cmd+Y dispatches history.redo (Windows muscle memory)", () => {
    const { editor, fire, executed } = makeStub();
    attachKeyboard(editor);
    fire({ key: "y", ctrl: true });
    expect(executed).toEqual(["history.redo"]);
  });

  it("Cmd+B / I / U dispatch the matching mark.toggle commands", () => {
    const { editor, fire, executed } = makeStub();
    attachKeyboard(editor);
    fire({ key: "b", meta: true });
    fire({ key: "i", meta: true });
    fire({ key: "u", meta: true });
    expect(executed).toEqual([
      "mark.toggle.bold",
      "mark.toggle.italic",
      "mark.toggle.underline",
    ]);
  });

  it("Cmd+Shift+S dispatches mark.toggle.strike", () => {
    const { editor, fire, executed } = makeStub();
    attachKeyboard(editor);
    fire({ key: "s", meta: true, shift: true });
    expect(executed).toEqual(["mark.toggle.strike"]);
  });

  it("Cmd+Shift+Enter dispatches section.insertBreakAfter", () => {
    const { editor, fire, executed } = makeStub();
    attachKeyboard(editor);
    fire({ key: "Enter", code: "Enter", meta: true, shift: true });
    expect(executed).toEqual(["section.insertBreakAfter"]);
  });

  it("ignores plain key presses without Cmd / Ctrl", () => {
    const { editor, fire, executed } = makeStub();
    attachKeyboard(editor);
    fire({ key: "b" });
    fire({ key: "z" });
    expect(executed).toEqual([]);
  });

  it("DEFAULT_BINDINGS export is non-empty + immutable in shape", () => {
    expect(DEFAULT_BINDINGS.length).toBeGreaterThan(5);
    for (const b of DEFAULT_BINDINGS) {
      expect(typeof b.match).toBe("function");
      expect(typeof b.command).toBe("string");
    }
  });
});

describe("attachKeyboard — user bindings", () => {
  it("user binding wins over a default that matches the same combo", () => {
    const { editor, fire, executed } = makeStub();
    attachKeyboard(editor, {
      bindings: [
        {
          match: (e) => (e.ctrl || e.meta) && e.key === "b",
          command: "my.custom",
        },
      ],
    });
    fire({ key: "b", meta: true });
    expect(executed).toEqual(["my.custom"]);
  });

  it("user binding adds a new combo without removing defaults", () => {
    const { editor, fire, executed } = makeStub();
    attachKeyboard(editor, {
      bindings: [
        {
          match: (e) => (e.ctrl || e.meta) && e.key === "/",
          command: "open.search",
        },
      ],
    });
    fire({ key: "b", meta: true });
    fire({ key: "/", meta: true });
    expect(executed).toEqual(["mark.toggle.bold", "open.search"]);
  });

  it("detach unsubscribes — no further dispatches fire", () => {
    const { editor, fire, executed } = makeStub();
    const off = attachKeyboard(editor);
    fire({ key: "b", meta: true });
    off();
    fire({ key: "b", meta: true });
    expect(executed).toEqual(["mark.toggle.bold"]);
  });
});
