import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { emptyDocument, namedStyle } from "../doc/builders";
import type { NamedStyle } from "../doc/types";
import { HeadlessSobree } from "../headless";
import { Editor } from "./";
import { mergeNamedStyle } from "./internal/mutations";

const base = (): NamedStyle => ({
  id: "Caption",
  type: "paragraph",
  displayName: "Caption",
  basedOn: "Normal",
  runDefaults: { italic: true, fontSizePt: 9 },
});

describe("mergeNamedStyle", () => {
  it("replaces present fields and leaves the rest", () => {
    const out = mergeNamedStyle(base(), { displayName: "Figure caption" });
    expect(out.displayName).toBe("Figure caption");
    expect(out.basedOn).toBe("Normal");
    expect(out.runDefaults).toEqual({ italic: true, fontSizePt: 9 });
  });

  it("clears an optional field on explicit undefined", () => {
    const out = mergeNamedStyle(base(), { basedOn: undefined });
    expect("basedOn" in out).toBe(false);
  });

  it("never clears the required type / displayName", () => {
    const out = mergeNamedStyle(base(), {
      type: undefined,
      displayName: undefined,
    } as never);
    expect(out.type).toBe("paragraph");
    expect(out.displayName).toBe("Caption");
  });
});

describe("editor.styles (DOM editor)", () => {
  const setup = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    return { editor: new Editor(host, { initialDocument: emptyDocument() }), host };
  };

  it("define adds a style; rejects a duplicate id", () => {
    const { editor, host } = setup();
    try {
      expect(
        editor.styles.define(namedStyle("Caption", { runDefaults: { italic: true } })).ok,
      ).toBe(true);
      expect(editor.getDocument().styles.some((s) => s.id === "Caption")).toBe(true);
      const dup = editor.styles.define(namedStyle("Caption"));
      expect(dup.ok).toBe(false);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("update merges into an existing style; fails when missing", () => {
    const { editor, host } = setup();
    try {
      const ok = editor.styles.update("Normal", { runDefaults: { fontSizePt: 12 } });
      expect(ok.ok).toBe(true);
      expect(
        editor.getDocument().styles.find((s) => s.id === "Normal")?.runDefaults?.fontSizePt,
      ).toBe(12);
      expect(editor.styles.update("Nope", { displayName: "x" }).ok).toBe(false);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("remove drops a style; fails when missing", () => {
    const { editor, host } = setup();
    try {
      editor.styles.define(namedStyle("Temp"));
      expect(editor.styles.remove("Temp").ok).toBe(true);
      expect(editor.getDocument().styles.some((s) => s.id === "Temp")).toBe(false);
      expect(editor.styles.remove("Temp").ok).toBe(false);
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});

describe("style ops (headless + Y.Doc parity)", () => {
  it("defineStyle mirrors to a joining peer", () => {
    const ydocA = new Y.Doc();
    const peerA = new HeadlessSobree(ydocA, { initialDocument: emptyDocument() });
    try {
      peerA.defineStyle(namedStyle("Caption", { runDefaults: { italic: true } }));
      const ydocB = new Y.Doc();
      Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));
      const peerB = new HeadlessSobree(ydocB);
      try {
        expect(peerB.getDocument().styles.some((s) => s.id === "Caption")).toBe(true);
      } finally {
        peerB.destroy();
      }
    } finally {
      peerA.destroy();
    }
  });
});
