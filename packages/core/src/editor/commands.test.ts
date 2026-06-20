import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "./";

function setupEditor(): { ed: Editor } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return { ed: new Editor(host, {}) };
}

describe("editor.commands", () => {
  let ed: Editor;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    ({ ed } = setupEditor());
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    ed.destroy();
    consoleSpy.mockRestore();
  });

  it("register / has / list / execute round-trip", () => {
    const run = vi.fn();
    ed.commands.register({ name: "test.run", title: "Test", run });

    expect(ed.commands.has("test.run")).toBe(true);
    expect(ed.commands.list().some((c) => c.name === "test.run")).toBe(true);

    ed.commands.execute("test.run");
    expect(run).toHaveBeenCalledOnce();
  });

  it("execute on unknown command warns and is a no-op", () => {
    ed.commands.execute("does.not.exist");
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("isAvailable=false short-circuits run", () => {
    const run = vi.fn();
    ed.commands.register({
      name: "test.guarded",
      run,
      isAvailable: () => false,
    });
    ed.commands.execute("test.guarded");
    expect(run).not.toHaveBeenCalled();
  });

  it("isActive surfaces in the snapshot", () => {
    let on = false;
    ed.commands.register({
      name: "test.toggle",
      run: () => {
        on = !on;
      },
      isActive: () => on,
    });
    expect(ed.commands.list().find((c) => c.name === "test.toggle")?.isActive).toBe(false);
    ed.commands.execute("test.toggle");
    expect(ed.commands.list().find((c) => c.name === "test.toggle")?.isActive).toBe(true);
  });

  it("returned unsubscribe removes the registration", () => {
    const off = ed.commands.register({ name: "test.disposable", run: () => {} });
    expect(ed.commands.has("test.disposable")).toBe(true);
    off();
    expect(ed.commands.has("test.disposable")).toBe(false);
  });

  it("re-register replaces the prior definition", () => {
    const a = vi.fn();
    const b = vi.fn();
    ed.commands.register({ name: "test.replace", run: a });
    ed.commands.register({ name: "test.replace", run: b });
    ed.commands.execute("test.replace");
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it("a command throwing is logged but doesn't propagate", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    ed.commands.register({
      name: "test.boom",
      run: () => {
        throw new Error("nope");
      },
    });
    expect(() => ed.commands.execute("test.boom")).not.toThrow();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("list() defaults title to name and isAvailable to true", () => {
    ed.commands.register({ name: "test.bare", run: () => {} });
    const snap = ed.commands.list().find((c) => c.name === "test.bare");
    expect(snap?.title).toBe("test.bare");
    expect(snap?.isAvailable).toBe(true);
    expect(snap?.isActive).toBe(false);
  });

  it("applyFrameMark is a no-op (false) when the caret is not in a textbox frame", () => {
    // Body selection → the mark command falls through to the body path.
    expect(ed.applyFrameMark("strong")).toBe(false);
    expect(ed.frameMarkActive("strong")).toBeNull();
  });

  it("applyFrameMark routes to the frame when the caret is inside an editable textbox frame", () => {
    const frame = document.createElement("div");
    frame.className = "paper-anchor";
    frame.dataset.anchorTextbox = "";
    frame.dataset.anchorId = "anchor-9";
    frame.contentEditable = "true";
    const p = document.createElement("p");
    p.textContent = "Hi";
    frame.appendChild(p);
    ed.host.appendChild(frame);
    const sel = document.getSelection()!;
    const r = document.createRange();
    r.selectNodeContents(p);
    sel.removeAllRanges();
    sel.addRange(r);
    // jsdom has no execCommand — mock it to observe the native command the
    // frame path issues (its document effect isn't testable here; the
    // playground covers the full round-trip).
    const execSpy = vi.fn(() => true);
    (document as unknown as { execCommand: typeof document.execCommand }).execCommand =
      execSpy as unknown as typeof document.execCommand;
    expect(ed.applyFrameMark("strong")).toBe(true);
    expect(execSpy).toHaveBeenCalledWith("bold");
    expect(ed.applyFrameMark("u")).toBe(true);
    expect(execSpy).toHaveBeenCalledWith("underline");
  });
});
