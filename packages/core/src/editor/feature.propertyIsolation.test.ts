import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyDocument,
  paragraph,
  sectionBreak,
  table,
  tableCell,
  tableRow,
  text,
} from "../doc/builders";
import type { Block, SobreeDocument } from "../doc/types";
import { Editor } from "./index";

/**
 * Regression: a block-property mutation changes ONLY the properties it
 * targets — nothing else in the document. For each block kind we snapshot
 * the whole AST, change a couple of properties through the public API, and
 * assert the deep-diff is exactly those property paths. Catches mutators
 * that leak side effects into other blocks, sibling properties, sections,
 * or styles.
 */

/** Dot-paths of every leaf that differs between two JSON values. */
function changedPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (a === b) return [];
  const bothObjects = typeof a === "object" && a !== null && typeof b === "object" && b !== null;
  if (!bothObjects) return [prefix];
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  const out: string[] = [];
  for (const k of keys) {
    const next = prefix ? `${prefix}.${k}` : k;
    out.push(
      ...changedPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], next),
    );
  }
  return out;
}

/** The JSON-clean slice of the document the AST diff cares about. */
function snapshot(doc: SobreeDocument): unknown {
  return JSON.parse(
    JSON.stringify({
      body: doc.body,
      sections: doc.sections,
      styles: doc.styles,
      numbering: doc.numbering,
    }),
  );
}

interface Case {
  kind: string;
  /** Blocks placed around the target so isolation (no sibling leak) is tested. */
  body: () => Block[];
  /** Index of the block under test. */
  index: number;
  /** Change ≥1 property via the public API; returns the changed `properties`
   *  sub-paths expected in the diff (relative to `body.{index}`). */
  mutate: (editor: Editor, index: number) => string[];
}

const CASES: Case[] = [
  {
    kind: "paragraph",
    body: () => [
      paragraph([text("before")]),
      paragraph([text("target")]),
      paragraph([text("after")]),
    ],
    index: 1,
    // Targeted merge mutator — the strongest isolation check.
    mutate: (editor, i) => {
      const ref = editor.getBlock(i);
      const r = editor.applyBlockProperties([{ id: ref.id, version: ref.version }], {
        alignment: "center",
        keepNext: true,
      });
      expect(r.ok).toBe(true);
      return ["properties.alignment", "properties.keepNext"];
    },
  },
  {
    kind: "table",
    body: () => [
      paragraph([text("before")]),
      table([tableRow([tableCell([paragraph([text("c")])])])], {
        grid: [1000],
        properties: { alignment: "left" },
      }),
      paragraph([text("after")]),
    ],
    index: 1,
    // Whole-block replace (the table property path) — verifies it doesn't
    // disturb other blocks while changing two properties.
    mutate: (editor, i) => {
      const ref = editor.getBlock(i);
      const tbl = editor.getDocument().body[i] as Extract<Block, { kind: "table" }>;
      const next: Block = {
        ...tbl,
        properties: { ...tbl.properties, alignment: "center", styleId: "Grid" },
      };
      const r = editor.replaceBlock({ id: ref.id, version: ref.version }, next);
      expect(r.ok).toBe(true);
      return ["properties.alignment", "properties.styleId"];
    },
  },
  {
    kind: "section_break",
    body: () => [paragraph([text("before")]), sectionBreak(1), paragraph([text("after")])],
    index: 1,
    // Only one mutable property exists — change it and assert isolation.
    mutate: (editor, i) => {
      const ref = editor.getBlock(i);
      const r = editor.replaceBlock({ id: ref.id, version: ref.version }, sectionBreak(2));
      expect(r.ok).toBe(true);
      return ["toSectionIndex"];
    },
  },
  {
    kind: "inline_frame",
    body: () => [paragraph([text("before")]), bareInlineFrame(), paragraph([text("after")])],
    index: 1,
    // Two flag properties live at the top of the frame (no `properties` bag).
    mutate: (editor, i) => {
      const ref = editor.getBlock(i);
      const frame = editor.getDocument().body[i] as Extract<Block, { kind: "inline_frame" }>;
      const r = editor.replaceBlock(
        { id: ref.id, version: ref.version },
        { ...frame, pageBreakBefore: true, keepNext: true },
      );
      expect(r.ok).toBe(true);
      return ["pageBreakBefore", "keepNext"];
    },
  },
];

/** A minimal empty inline frame (no builder exists for this kind). */
function bareInlineFrame(): Block {
  return {
    kind: "inline_frame",
    groupExtentEmu: { wEmu: 1000, hEmu: 1000 },
    sizeEmu: { wEmu: 1000, hEmu: 1000 },
    textboxes: [],
    pictures: [],
    shapes: [],
  };
}

describe("property isolation — a mutation changes only its target properties", () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  for (const c of CASES) {
    it(`${c.kind}: only the changed properties differ in the whole AST`, () => {
      const doc = emptyDocument();
      doc.body = c.body();
      // section needs to exist for a section_break(2) target.
      if (c.kind === "section_break")
        doc.sections = [doc.sections[0]!, doc.sections[0]!, doc.sections[0]!];
      const editor = new Editor(host, { initialDocument: doc });

      const before = snapshot(editor.getDocument());
      const expectedSubPaths = c.mutate(editor, c.index);
      const after = snapshot(editor.getDocument());

      const diff = changedPaths(before, after).sort();
      const expected = expectedSubPaths.map((p) => `body.${c.index}.${p}`).sort();
      expect(diff).toEqual(expected);
      editor.destroy();
    });
  }

  it("the diff helper itself flags exactly the changed leaf", () => {
    const a = { x: 1, y: { z: 2, w: 3 }, list: [1, 2] };
    const b = { x: 1, y: { z: 9, w: 3 }, list: [1, 5] };
    expect(changedPaths(a, b).sort()).toEqual(["list.1", "y.z"]);
  });
});
