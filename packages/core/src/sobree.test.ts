import { defaultSection, emptyDocument, paragraph, text } from "./doc/builders";
import type { SobreeDocument } from "./doc/types";
import { Sobree } from "./sobree";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Minimal multi-section fixture used to exercise section-aware paths
 * without depending on the demo's example doc (which lives in
 * `apps/demo`). Title page (centred) + body (top-aligned).
 */
function multiSectionDoc(): SobreeDocument {
  const d = emptyDocument();
  d.body = [
    paragraph([text("Title")]),
    { kind: "section_break", toSectionIndex: 1 },
    paragraph([text("Body chapter 1")]),
  ];
  d.sections = [
    { ...defaultSection(), vAlign: "center", titlePage: true, type: "nextPage" },
    { ...defaultSection() },
  ];
  return d;
}

function setupSobree(opts: ConstructorParameters<typeof Sobree>[1] = {}): {
  sobree: Sobree;
  container: HTMLElement;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  // Default to no document so each test sets up just what it needs
  // (avoids the demo example dragging in 100+ blocks).
  return { sobree: new Sobree(container, opts), container };
}

describe("Sobree façade: mode", () => {
  let sobree: Sobree;
  beforeEach(() => {
    ({ sobree } = setupSobree());
  });
  afterEach(() => {
    sobree.destroy();
  });

  it("default mode is 'edit'", () => {
    expect(sobree.getMode()).toBe("edit");
  });

  it("setMode('read') flips contentEditable on every content host", () => {
    sobree.setMode("read");
    for (const host of (sobree as unknown as { stack: { contentHosts: HTMLElement[] } }).stack.contentHosts) {
      expect(host.contentEditable).toBe("false");
    }
  });

  it("setMode toggles `is-read-mode` class on the stack root", () => {
    sobree.setMode("read");
    expect(sobree.stackRoot.classList.contains("is-read-mode")).toBe(true);
    sobree.setMode("edit");
    expect(sobree.stackRoot.classList.contains("is-read-mode")).toBe(false);
  });

  it("fires `mode-change` with the new mode", () => {
    const cb = vi.fn();
    sobree.on("mode-change", cb);
    sobree.setMode("read");
    expect(cb).toHaveBeenCalledWith({ mode: "read" });
  });

  it("setMode is idempotent — same mode does NOT re-fire the event", () => {
    const cb = vi.fn();
    sobree.on("mode-change", cb);
    sobree.setMode("edit"); // already edit
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("Sobree façade: plugin slots", () => {
  it("registers mark commands on the editor (independent of any plugin)", () => {
    // Mark + history commands are owned by the Editor core itself, so
    // they're available even when no plugins are mounted. The
    // keyboard plugin only maps Cmd+B → execute("mark.toggle.bold");
    // it doesn't own the command.
    const { sobree } = setupSobree();
    expect(sobree.editor.commands.has("mark.toggle.bold")).toBe(true);
    expect(sobree.editor.commands.has("mark.toggle.italic")).toBe(true);
    expect(sobree.editor.commands.has("history.undo")).toBe(true);
    expect(sobree.editor.commands.has("history.redo")).toBe(true);
    sobree.destroy();
  });

  // The pluggable surface moved from Sobree to createSobree —
  // user plugins are no longer accepted via SobreeOptions. See
  // createSobree.test.ts for plugin-order + setup-failure coverage.
});

describe("Sobree façade: vAlign through PageSetup", () => {
  it("setPageSetup({ verticalAlign: 'center' }) propagates to section[0].vAlign", () => {
    const { sobree } = setupSobree();
    sobree.setPageSetup({ verticalAlign: "center" });
    // Round-trip: getSectionSetup should return what we set.
    expect(sobree.getSectionSetup(0).verticalAlign).toBe("center");
    sobree.destroy();
  });

  it("getSectionCount() returns 1 for an empty-default doc", () => {
    const { sobree } = setupSobree();
    expect(sobree.getSectionCount()).toBe(1);
    sobree.destroy();
  });

  it("multi-section docs: getSectionCount and getSectionSetup walk all sections", () => {
    const { sobree } = setupSobree({ initialDocument: multiSectionDoc() });
    expect(sobree.getSectionCount()).toBe(2);
    // section 0 = title page (centred); section 1 = body (top default).
    expect(sobree.getSectionSetup(0).verticalAlign).toBe("center");
    expect(sobree.getSectionSetup(1).verticalAlign).toBe("top");
    sobree.destroy();
  });

  it("setSectionSetup(1, …) writes back to a non-zero section", () => {
    const { sobree } = setupSobree({ initialDocument: multiSectionDoc() });
    sobree.setSectionSetup(1, { verticalAlign: "bottom" });
    expect(sobree.getSectionSetup(1).verticalAlign).toBe("bottom");
    // section 0 still center.
    expect(sobree.getSectionSetup(0).verticalAlign).toBe("center");
    sobree.destroy();
  });
});
