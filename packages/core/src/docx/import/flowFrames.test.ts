import { describe, expect, it } from "vitest";
import type { AnchoredContent, AnchoredFrame, Block, Paragraph } from "../../doc/types";
import { flowDisplacingTextboxes } from "./flowFrames";

function para(text: string): Paragraph {
  return { kind: "paragraph", runs: [{ kind: "text", text, properties: {} }], properties: {} };
}

function frame(
  id: string,
  paragraphIndex: number | undefined,
  content: AnchoredContent,
  over: Partial<AnchoredFrame> = {},
): AnchoredFrame {
  return {
    id,
    anchor: {
      sectionIndex: 0,
      horizontalFrom: "page",
      verticalFrom: over.anchor?.verticalFrom ?? "paragraph",
      ...(paragraphIndex !== undefined ? { paragraphIndex } : {}),
    },
    offsetXEmu: 0,
    offsetYEmu: 0,
    widthEmu: 100,
    heightEmu: 100,
    wrap: "square",
    content,
    ...over,
  };
}

const textbox = (...texts: string[]): AnchoredContent => ({
  kind: "textbox",
  body: texts.map(para),
});

describe("flowDisplacingTextboxes", () => {
  it("splices a displacing textbox's body after its anchor paragraph", () => {
    const body: Block[] = [para("A"), para("B"), para("C")];
    const f = frame("f1", 1, textbox("X", "Y"));
    const out = flowDisplacingTextboxes(body, [f]);
    expect(
      out.body.map(
        (b) => (b as Paragraph).runs[0] && ((b as Paragraph).runs[0] as { text: string }).text,
      ),
    ).toEqual(["A", "B", "X", "Y", "C"]);
    expect(out.frames).toHaveLength(0);
  });

  it("flattens a group depth-first (heading then details), carrying the arrow as an inline image", () => {
    const group: AnchoredContent = {
      kind: "group",
      children: [
        frame("c1", undefined, {
          kind: "group",
          children: [
            frame("arrow", undefined, { kind: "picture", partPath: "media/arrow.png" }),
            frame("head", undefined, textbox("Project: X")),
          ],
          childCoordSystemCx: 1,
          childCoordSystemCy: 1,
        }),
        frame("details", undefined, textbox("Period", "Role")),
      ],
      childCoordSystemCx: 1,
      childCoordSystemCy: 1,
    };
    const out = flowDisplacingTextboxes([para("anchor")], [frame("g", 0, group)]);
    // Text content in order (joining text runs only).
    const text = (b: Block) =>
      (b as Paragraph).runs
        .filter((r) => r.kind === "text")
        .map((r) => (r as { text: string }).text)
        .join("");
    expect(out.body.map(text)).toEqual(["anchor", "Project: X", "Period", "Role"]);
    // The arrow rides on the heading paragraph as a leading inline image.
    const heading = out.body[1] as Paragraph;
    expect(heading.runs[0]).toMatchObject({
      kind: "drawing",
      partPath: "media/arrow.png",
      placement: "inline",
    });
  });

  it("leaves non-displacing frames untouched (wrapNone, behind, page-relative)", () => {
    const body = [para("A")];
    const wrapNone = frame("n", 0, textbox("Z"), { wrap: "none" });
    const behind = frame("b", 0, textbox("Z"), { behindText: true });
    const pageRel = frame("p", 0, textbox("Z"), {
      anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page", paragraphIndex: 0 },
    });
    const out = flowDisplacingTextboxes(body, [wrapNone, behind, pageRel]);
    expect(out.body).toHaveLength(1);
    expect(out.frames).toHaveLength(3);
  });

  it("keeps bordered/filled boxes as overlays (chrome would be lost)", () => {
    const bordered = frame("box", 0, {
      kind: "textbox",
      body: [para("Z")],
      border: { color: "#000", widthEmu: 9525, style: "solid" },
    });
    const out = flowDisplacingTextboxes([para("A")], [bordered]);
    expect(out.body).toHaveLength(1);
    expect(out.frames).toHaveLength(1);
  });

  it("remaps remaining overlay frames' paragraphIndex past inserted blocks", () => {
    const body = [para("A"), para("B"), para("C")];
    const flow = frame("flow", 0, textbox("X", "Y")); // inserts 2 after index 0
    const overlay = frame("ov", 2, textbox("Z"), { wrap: "none" }); // anchored to C
    const out = flowDisplacingTextboxes(body, [flow, overlay]);
    // C moved from index 2 → 4 (A,X,Y,B,C? no: A then X,Y then B then C)
    // body: [A, X, Y, B, C] → C at index 4
    const ov = out.frames.find((f) => f.id === "ov");
    expect(ov?.anchor.paragraphIndex).toBe(4);
  });

  it("is a no-op (copies) when no frame is flowable", () => {
    const body = [para("A")];
    const out = flowDisplacingTextboxes(body, []);
    expect(out.body).toEqual(body);
    expect(out.body).not.toBe(body);
  });
});
