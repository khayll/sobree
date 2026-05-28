import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockInfo, BlockRef, Editor, Paragraph, Table } from "@sobree/core";
import type { BlockTarget } from "../blockKinds";

// We need to access the popover's click handler to drive applyConversion,
// since applyConversion itself isn't exported. The popover wires it up.
import { openChangeTypePopover } from "./changeType";

/**
 * Build a minimal Editor stub the popover needs for the table → paragraph
 * conversion path: getDocument / getBlockById / replaceBlock /
 * applyBlockProperties / setDocument. Other methods aren't reached
 * during a single conversion click.
 */
function makeEditorStub(initialDoc: { body: Array<Paragraph | Table>; numbering: unknown[] }) {
  let doc: { body: Array<Paragraph | Table>; numbering: unknown[] } = {
    ...initialDoc,
    body: initialDoc.body.slice(),
  };
  const replaceBlock = vi.fn(
    (target: BlockRef, block: Paragraph | Table) => {
      const idx = Number(target.id.slice(1)) - 1;
      const next = doc.body.slice();
      next[idx] = block;
      doc = { ...doc, body: next };
      return { ok: true } as const;
    },
  );
  const applyBlockProperties = vi.fn();
  const setDocument = vi.fn();
  const getDocument = () => doc;
  const getBlockById = (id: string): BlockInfo | null => {
    const idx = Number(id.slice(1)) - 1;
    const block = doc.body[idx];
    if (!block) return null;
    if (block.kind === "paragraph") {
      return {
        index: idx,
        id,
        version: 1,
        kind: "paragraph",
        text: block.runs.map((r) => (r.kind === "text" ? r.text : "")).join(""),
        length: 0,
      } as BlockInfo;
    }
    return { index: idx, id, version: 1, kind: "table", text: "", length: 0 } as BlockInfo;
  };
  return {
    editor: {
      getDocument,
      getBlockById,
      replaceBlock,
      applyBlockProperties,
      setDocument,
    } as unknown as Editor,
    spies: { replaceBlock, applyBlockProperties, setDocument },
    getDoc: () => doc,
  };
}

function makeTableBlock(text: string): Table {
  return {
    kind: "table",
    grid: [3000, 3000, 3000],
    rows: [
      {
        cells: [
          {
            content: [
              {
                kind: "paragraph",
                properties: {},
                runs: [{ kind: "text", text, properties: {} }],
              },
            ],
          },
          { content: [{ kind: "paragraph", properties: {}, runs: [] }] },
          { content: [{ kind: "paragraph", properties: {}, runs: [] }] },
        ],
      },
      {
        cells: [
          {
            content: [
              { kind: "paragraph", properties: {}, runs: [{ kind: "text", text: "row2", properties: {} }] },
            ],
          },
          { content: [{ kind: "paragraph", properties: {}, runs: [] }] },
          { content: [{ kind: "paragraph", properties: {}, runs: [] }] },
        ],
      },
    ],
    properties: {},
  };
}

function clickTargetKind(popoverClose: () => void, target: HTMLElement) {
  void popoverClose;
  target.click();
}

describe("changeType: table → paragraph regression", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("flattens a table into a paragraph when converting to heading:2", () => {
    const stub = makeEditorStub({
      body: [makeTableBlock("Sobree dev playground")],
      numbering: [],
    });
    const ref: BlockRef = { id: "b1", version: 1 };
    const target: BlockTarget = {
      kind: "table",
      element: document.createElement("table"),
      paper: document.createElement("div"),
    };
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);

    const close = openChangeTypePopover(
      trigger,
      { editor: stub.editor, target, refs: [ref] },
      () => {},
    );

    const popover = document.querySelector(".sobree-change-popover");
    expect(popover).not.toBeNull();
    const heading2 = popover!.querySelector<HTMLButtonElement>(
      'button[data-target-kind="heading:2"]',
    );
    expect(heading2).not.toBeNull();
    clickTargetKind(close, heading2!);

    expect(stub.spies.replaceBlock).toHaveBeenCalledTimes(1);
    const replacement = stub.spies.replaceBlock.mock.calls[0]?.[1] as Paragraph;
    expect(replacement.kind).toBe("paragraph");
    // The text from cell (0,0) and (1,0) is concatenated with a space.
    const txt = replacement.runs
      .map((r) => (r.kind === "text" ? r.text : ""))
      .join("");
    expect(txt).toContain("Sobree dev playground");
    expect(txt).toContain("row2");
    // After the flatten, applyBlockProperties is called to apply the
    // Heading2 styleId on the freshly-replaced paragraph.
    expect(stub.spies.applyBlockProperties).toHaveBeenCalledTimes(1);
    const propsCall = stub.spies.applyBlockProperties.mock.calls[0];
    expect(propsCall?.[1]).toEqual({ styleId: "Heading2", numbering: undefined });
  });

  it("flattens a table into a paragraph when converting to plain paragraph", () => {
    const stub = makeEditorStub({
      body: [makeTableBlock("hello")],
      numbering: [],
    });
    const ref: BlockRef = { id: "b1", version: 1 };
    const target: BlockTarget = {
      kind: "table",
      element: document.createElement("table"),
      paper: document.createElement("div"),
    };
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);

    openChangeTypePopover(
      trigger,
      { editor: stub.editor, target, refs: [ref] },
      () => {},
    );

    const popover = document.querySelector(".sobree-change-popover");
    const paragraphBtn = popover!.querySelector<HTMLButtonElement>(
      'button[data-target-kind="paragraph"]',
    );
    paragraphBtn!.click();

    expect(stub.spies.replaceBlock).toHaveBeenCalledTimes(1);
    expect(stub.spies.applyBlockProperties).toHaveBeenCalledTimes(1);
    expect(stub.spies.applyBlockProperties.mock.calls[0]?.[1]).toEqual({
      styleId: undefined,
      numbering: undefined,
    });
  });
});
