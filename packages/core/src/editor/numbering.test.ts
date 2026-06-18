import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  bulletDefinition,
  numberingDefinition,
  numberingLevel,
  orderedDefinition,
} from "../doc/builders";
import { emptyDocument } from "../doc/builders";
import { HeadlessSobree } from "../headless";
import { Editor } from "./";

describe("numbering builders", () => {
  it("numberingLevel emits only set optionals", () => {
    expect(numberingLevel(0, "decimal", "%1.")).toEqual({
      level: 0,
      format: "decimal",
      text: "%1.",
    });
    const lvl = numberingLevel(1, "bullet", "•", { paragraphIndent: { leftTwips: 720 } });
    expect(lvl.paragraphIndent).toEqual({ leftTwips: 720 });
  });

  it("bulletDefinition / orderedDefinition build multi-level defs", () => {
    const b = bulletDefinition(5);
    expect(b.numId).toBe(5);
    expect(b.abstractFormat.levels).toHaveLength(3);
    expect(b.abstractFormat.levels[0]?.format).toBe("bullet");
    const o = orderedDefinition(6, 2);
    expect(o.abstractFormat.levels).toHaveLength(2);
    expect(o.abstractFormat.levels[0]?.text).toBe("%1.");
  });
});

describe("editor.numbering (DOM editor)", () => {
  const setup = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    return { editor: new Editor(host, { initialDocument: emptyDocument() }), host };
  };

  it("define adds a definition; rejects a duplicate numId", () => {
    const { editor, host } = setup();
    try {
      expect(editor.numbering.define(bulletDefinition(1)).ok).toBe(true);
      expect(editor.getDocument().numbering.some((n) => n.numId === 1)).toBe(true);
      expect(editor.numbering.define(orderedDefinition(1)).ok).toBe(false);
    } finally {
      editor.destroy();
      host.remove();
    }
  });

  it("update replaces levels; remove drops it; both fail when missing", () => {
    const { editor, host } = setup();
    try {
      editor.numbering.define(bulletDefinition(2));
      const up = editor.numbering.update(2, [numberingLevel(0, "lowerRoman", "%1)")]);
      expect(up.ok).toBe(true);
      const def = editor.getDocument().numbering.find((n) => n.numId === 2);
      expect(def?.abstractFormat.levels).toHaveLength(1);
      expect(def?.abstractFormat.levels[0]?.format).toBe("lowerRoman");

      expect(editor.numbering.update(99, []).ok).toBe(false);
      expect(editor.numbering.remove(2).ok).toBe(true);
      expect(editor.numbering.remove(2).ok).toBe(false);
    } finally {
      editor.destroy();
      host.remove();
    }
  });
});

describe("numbering ops (headless + Y.Doc parity)", () => {
  it("defineNumbering mirrors to a joining peer", () => {
    const ydocA = new Y.Doc();
    const peerA = new HeadlessSobree(ydocA, { initialDocument: emptyDocument() });
    try {
      peerA.defineNumbering(numberingDefinition(7, [numberingLevel(0, "decimal", "%1.")]));
      const ydocB = new Y.Doc();
      Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));
      const peerB = new HeadlessSobree(ydocB);
      try {
        expect(peerB.getDocument().numbering.some((n) => n.numId === 7)).toBe(true);
      } finally {
        peerB.destroy();
      }
    } finally {
      peerA.destroy();
    }
  });
});
