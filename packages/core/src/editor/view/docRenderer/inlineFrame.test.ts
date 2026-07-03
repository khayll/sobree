// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { InlineFrame } from "../../../doc/types";
import { renderInlineFrameBlock } from "./inlineFrame";

function shapeFrame(shape: InlineFrame["shapes"][number]): InlineFrame {
  return {
    kind: "inline_frame",
    groupExtentEmu: { wEmu: 548640, hEmu: 640080 },
    sizeEmu: { wEmu: 548640, hEmu: 640080 },
    textboxes: [],
    pictures: [],
    shapes: [shape],
  };
}

describe("renderInlineFrameBlock — geometric shape decorations", () => {
  it("paints the shape's border alongside its fill", () => {
    // A photo-placeholder rect: theme solid fill plus a thin theme
    // outline (`<a:ln w="6350">`). The fill alone leaves the square a
    // borderless blob — Word draws the outline.
    const el = renderInlineFrameBlock(
      shapeFrame({
        geometry: "rect",
        offsetEmu: { xEmu: 0, yEmu: 0 },
        sizeEmu: { wEmu: 548640, hEmu: 640080 },
        fill: "#D3CE98",
        border: { color: "#6B7D72", widthEmu: 6350, style: "solid" },
      }),
      [],
      [],
      {},
      () => {},
    );
    const shape = el.firstElementChild as HTMLElement;
    expect(shape.style.background).toBe("rgb(211, 206, 152)");
    expect(shape.style.border).toBe("1px solid rgb(107, 125, 114)");
  });

  it("a fill-only shape stays borderless", () => {
    const el = renderInlineFrameBlock(
      shapeFrame({
        geometry: "rect",
        offsetEmu: { xEmu: 0, yEmu: 0 },
        sizeEmu: { wEmu: 548640, hEmu: 640080 },
        fill: "#D3CE98",
      }),
      [],
      [],
      {},
      () => {},
    );
    const shape = el.firstElementChild as HTMLElement;
    expect(shape.style.border).toBe("");
  });
});
