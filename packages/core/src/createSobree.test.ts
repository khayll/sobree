import { afterEach, describe, expect, it } from "vitest";
import { createSobree } from "./createSobree";
import { emptyDocument, paragraph, text } from "./doc/builders";
import type { SobreeHandle } from "./createSobree";

const handles: SobreeHandle[] = [];

function mount(): HTMLElement {
  const host = document.createElement("div");
  Object.assign(host.style, {
    width: "1200px",
    height: "800px",
  });
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  while (handles.length) handles.pop()?.destroy();
  document.body.innerHTML = "";
});

function track(h: SobreeHandle): SobreeHandle {
  handles.push(h);
  return h;
}

describe("createSobree", () => {
  it("mounts an editor into a host element with no content", () => {
    const host = mount();
    const editor = track(createSobree(host));
    expect(editor.editor).toBeDefined();
    expect(editor.viewport).toBeDefined();
    // ready resolves immediately for the empty path.
    return editor.ready.then((r) => {
      expect(r.warnings).toEqual([]);
    });
  });

  it("accepts a CSS selector as the target", () => {
    const host = mount();
    host.id = "test-editor";
    const editor = track(createSobree("#test-editor"));
    expect(editor.editor).toBeDefined();
  });

  it("throws on a selector that doesn't match an HTMLElement", () => {
    expect(() => createSobree("#does-not-exist-xyz")).toThrow(
      /did not match an HTMLElement/,
    );
  });

  it("seeds an AST literal as initial content", () => {
    const host = mount();
    const doc = emptyDocument();
    doc.body = [paragraph([text("seeded")])];
    const editor = track(createSobree(host, { content: doc }));
    const live = editor.getDocument();
    expect(live.body.length).toBe(1);
  });

  it("seeds a markdown string as initial content", () => {
    const host = mount();
    const editor = track(
      createSobree(host, { content: "# Title\n\nBody paragraph." }),
    );
    const live = editor.getDocument();
    expect(live.body.length).toBe(2);
    const first = live.body[0];
    if (first?.kind !== "paragraph") throw new Error("expected paragraph");
    expect(first.properties.styleId).toBe("Heading1");
  });

  it("mounts plugins from options.plugins in order", () => {
    const host = mount();
    const order: string[] = [];
    const trackingPlugin = (label: string) => ({
      name: label,
      setup() {
        order.push(`setup-${label}`);
        return {
          destroy() {
            order.push(`destroy-${label}`);
          },
        };
      },
    });
    const editor = track(
      createSobree(host, {
        plugins: [trackingPlugin("a"), trackingPlugin("b")],
      }),
    );
    expect(order).toEqual(["setup-a", "setup-b"]);
    editor.destroy();
    handles.length = 0;
    expect(order).toEqual([
      "setup-a",
      "setup-b",
      // LIFO destroy order.
      "destroy-b",
      "destroy-a",
    ]);
  });

  it("isolates a plugin whose setup throws — its peers still mount", () => {
    const host = mount();
    let bMounted = false;
    const exploding = {
      name: "boom",
      setup() {
        throw new Error("setup failed");
      },
    };
    const ok = {
      name: "ok",
      setup() {
        bMounted = true;
        return { destroy: () => {} };
      },
    };
    track(createSobree(host, { plugins: [exploding, ok] }));
    expect(bMounted).toBe(true);
  });

  it("loadMarkdown replaces the document", () => {
    const host = mount();
    const editor = track(createSobree(host));
    editor.loadMarkdown("# Replaced\n\nNew body.");
    const live = editor.getDocument();
    expect(live.body.length).toBe(2);
    const first = live.body[0];
    if (first?.kind !== "paragraph") throw new Error("expected paragraph");
    expect(first.properties.styleId).toBe("Heading1");
  });

  it("toDocx returns a Blob and warnings array", () => {
    const host = mount();
    const editor = track(
      createSobree(host, { content: "# Saveable\n\nContent." }),
    );
    const out = editor.toDocx();
    expect(out.blob).toBeInstanceOf(Blob);
    expect(Array.isArray(out.warnings)).toBe(true);
  });

  it("commands proxy points to the underlying CommandBus", () => {
    const host = mount();
    const editor = track(createSobree(host));
    expect(editor.commands).toBe(editor.editor.commands);
  });

  it("on() proxies events from Sobree", () => {
    const host = mount();
    const editor = track(createSobree(host));
    let pageCount = -1;
    const off = editor.on("paginate", (p) => {
      pageCount = p.pageCount;
    });
    // Force a repagination so the listener fires.
    editor.sobree.repaginate();
    off();
    expect(pageCount).toBeGreaterThanOrEqual(0);
  });

  it("destroy tears down plugins + Sobree without leaks", () => {
    const host = mount();
    const editor = createSobree(host);
    editor.destroy();
    // Re-destroy should not throw (idempotency would be nice; at least
    // the first destroy must not leak listeners — confirm by re-mounting).
    expect(() => {
      const next = track(createSobree(host));
      next.destroy();
    }).not.toThrow();
  });
});
