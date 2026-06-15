import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendBlock, emptyDocument, paragraph, text } from "../doc/builders";
import type { SobreeDocument } from "../doc/types";
import { Editor } from "./";

function setupEditor(doc?: SobreeDocument): { ed: Editor; host: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ed = new Editor(host, doc ? { initialDocument: doc } : {});
  return { ed, host };
}

function twoParaDoc(): SobreeDocument {
  const d = emptyDocument();
  d.body = [];
  appendBlock(d, paragraph([text("hello")]));
  appendBlock(d, paragraph([text("world")]));
  return d;
}

describe("editor: selection event", () => {
  let ed: Editor;
  beforeEach(() => {
    ({ ed } = setupEditor(twoParaDoc()));
  });
  afterEach(() => {
    ed.destroy();
  });

  it("fires when document selectionchange dispatches", () => {
    const cb = vi.fn();
    ed.on("selection", cb);
    document.dispatchEvent(new Event("selectionchange"));
    expect(cb).toHaveBeenCalledOnce();
  });

  it("payload carries normalised range / caret / block (null when no selection)", () => {
    const cb = vi.fn();
    ed.on("selection", cb);
    document.dispatchEvent(new Event("selectionchange"));
    const payload = cb.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(payload).toHaveProperty("selection");
    expect(payload).toHaveProperty("range");
    expect(payload).toHaveProperty("caret");
    expect(payload).toHaveProperty("block");
  });

  it("multiple subscribers all receive the same payload", () => {
    const a = vi.fn();
    const b = vi.fn();
    ed.on("selection", a);
    ed.on("selection", b);
    document.dispatchEvent(new Event("selectionchange"));
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(a.mock.calls[0]?.[0]).toEqual(b.mock.calls[0]?.[0]);
  });

  it("unsubscribe stops further dispatches", () => {
    const cb = vi.fn();
    const off = ed.on("selection", cb);
    document.dispatchEvent(new Event("selectionchange"));
    off();
    document.dispatchEvent(new Event("selectionchange"));
    expect(cb).toHaveBeenCalledOnce();
  });

  it("destroy detaches the document-level listener", () => {
    const cb = vi.fn();
    ed.on("selection", cb);
    ed.destroy();
    document.dispatchEvent(new Event("selectionchange"));
    expect(cb).not.toHaveBeenCalled();
  });

  it("listener throwing doesn't break siblings", () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    ed.on("selection", () => {
      throw new Error("boom");
    });
    const sibling = vi.fn();
    ed.on("selection", sibling);
    document.dispatchEvent(new Event("selectionchange"));
    expect(sibling).toHaveBeenCalledOnce();
    consoleErr.mockRestore();
  });
});

describe("editor: keydown event", () => {
  let ed: Editor;
  let host: HTMLElement;
  beforeEach(() => {
    ({ ed, host } = setupEditor(twoParaDoc()));
  });
  afterEach(() => {
    ed.destroy();
  });

  function fire(opts: KeyboardEventInit & { key: string; code?: string }): KeyboardEvent {
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...opts });
    host.dispatchEvent(e);
    return e;
  }

  it("fires on host keydown and lowercases letter keys", () => {
    const cb = vi.fn();
    ed.on("keydown", cb);
    fire({ key: "B", code: "KeyB", ctrlKey: true });
    expect(cb).toHaveBeenCalledOnce();
    const payload = cb.mock.calls[0]?.[0];
    expect(payload.key).toBe("b");
    expect(payload.code).toBe("KeyB");
    expect(payload.ctrl).toBe(true);
    expect(payload.shift).toBe(false);
  });

  it("preventDefault() proxies to the underlying event", () => {
    ed.on("keydown", (e) => e.preventDefault());
    const e = fire({ key: "Enter" });
    expect(e.defaultPrevented).toBe(true);
  });

  it("stopPropagation() halts the subscriber chain", () => {
    const a = vi.fn((e) => e.stopPropagation());
    const b = vi.fn();
    ed.on("keydown", a);
    ed.on("keydown", b);
    fire({ key: "Enter" });
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
  });

  it("preserves non-letter keys verbatim", () => {
    const cb = vi.fn();
    ed.on("keydown", cb);
    fire({ key: "Enter", code: "Enter" });
    expect(cb.mock.calls[0]?.[0].key).toBe("Enter");
  });

  it("destroy detaches the host listener", () => {
    const cb = vi.fn();
    ed.on("keydown", cb);
    ed.destroy();
    fire({ key: "Enter" });
    expect(cb).not.toHaveBeenCalled();
  });

  it("listener errors don't break siblings", () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    ed.on("keydown", () => {
      throw new Error("boom");
    });
    const sibling = vi.fn();
    ed.on("keydown", sibling);
    fire({ key: "x" });
    expect(sibling).toHaveBeenCalledOnce();
    consoleErr.mockRestore();
  });
});
