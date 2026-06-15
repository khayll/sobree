import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnchoredFrame, Block } from "../../../doc/types";
import { renderAnchorLayer } from "./anchorLayer";

const EMU_PER_MM = 36000;
let createObjectURLMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom doesn't implement URL.createObjectURL — install a fresh
  // mock per test so the call-count assertions are isolated.
  createObjectURLMock = vi.fn(() => "blob:mock");
  (URL as unknown as { createObjectURL: typeof URL.createObjectURL }).createObjectURL =
    createObjectURLMock as unknown as typeof URL.createObjectURL;
});

function ctx() {
  return {
    rawParts: { "word/media/img.png": new Uint8Array([0x89]) },
    pictureUrlCache: new Map<string, string>(),
  };
}

function pictureFrame(over: Partial<AnchoredFrame> = {}): AnchoredFrame {
  return {
    id: "anchor-0",
    anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page" },
    offsetXEmu: EMU_PER_MM * 10, // 10mm
    offsetYEmu: EMU_PER_MM * 20, // 20mm
    widthEmu: EMU_PER_MM * 50, // 50mm
    heightEmu: EMU_PER_MM * 30, // 30mm
    content: { kind: "picture", partPath: "word/media/img.png" },
    ...over,
  };
}

describe("renderAnchorLayer", () => {
  it("returns an empty isolated layer when given no frames", () => {
    const layer = renderAnchorLayer([], ctx());
    expect(layer.className).toBe("paper-anchors");
    expect(layer.children).toHaveLength(0);
    expect(layer.style.position).toBe("absolute");
    expect(layer.style.isolation).toBe("isolate");
  });

  it("converts EMU offsets and sizes to millimetres on the frame element", () => {
    const layer = renderAnchorLayer([pictureFrame()], ctx());
    const el = layer.children[0] as HTMLElement;
    expect(el.style.left).toBe("10mm");
    expect(el.style.top).toBe("20mm");
    expect(el.style.width).toBe("50mm");
    expect(el.style.height).toBe("30mm");
    expect(el.style.overflow).toBe("hidden");
    expect(el.dataset.anchorId).toBe("anchor-0");
  });

  it("paints picture frames as <img> children using the rawParts blob URL", () => {
    const layer = renderAnchorLayer([pictureFrame()], ctx());
    const img = layer.querySelector("img")!;
    expect(img).toBeTruthy();
    expect(img.src).toBe("blob:mock");
    expect(img.style.width).toBe("100%");
    expect(img.style.height).toBe("100%");
  });

  it("caches picture URLs across calls for the same partPath", () => {
    const sharedCtx = ctx();
    renderAnchorLayer([pictureFrame()], sharedCtx);
    renderAnchorLayer([pictureFrame({ id: "anchor-1" })], sharedCtx);
    expect(sharedCtx.pictureUrlCache.get("word/media/img.png")).toBe("blob:mock");
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it("renders shape frames as filled divs with optional border", () => {
    const frame: AnchoredFrame = pictureFrame({
      id: "shape-1",
      content: {
        kind: "shape",
        geometry: "rect",
        fill: "#abcdef",
        border: { color: "#000000", widthEmu: 9525, style: "dashed" },
      },
    });
    const layer = renderAnchorLayer([frame], ctx());
    const el = layer.children[0] as HTMLElement;
    expect(el.style.background).toBe("rgb(171, 205, 239)");
    expect(el.style.border).toBe("1px dashed rgb(0, 0, 0)");
  });

  it("renders a custom-geometry shape as a filled, stretched SVG path", () => {
    const frame: AnchoredFrame = pictureFrame({
      content: {
        kind: "shape",
        geometry: "custom",
        fill: "#fed600",
        path: { widthEmu: 100, heightEmu: 200, d: "M 0 0 L 100 0 Z" },
      },
    });
    const layer = renderAnchorLayer([frame], ctx());
    const svg = layer.querySelector("svg")!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("viewBox")).toBe("0 0 100 200");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    const path = svg.querySelector("path")!;
    expect(path.getAttribute("d")).toBe("M 0 0 L 100 0 Z");
    expect(path.getAttribute("fill")).toBe("#fed600");
    expect(path.getAttribute("fill-rule")).toBe("evenodd");
    // The custom path must NOT also paint a CSS background rectangle.
    expect((layer.children[0] as HTMLElement).style.background).toBe("");
  });

  it("renders ellipse shapes with border-radius 50%", () => {
    const frame: AnchoredFrame = pictureFrame({
      content: { kind: "shape", geometry: "ellipse", fill: "#ff0000" },
    });
    const layer = renderAnchorLayer([frame], ctx());
    const el = layer.children[0] as HTMLElement;
    expect(el.style.borderRadius).toBe("50%");
  });

  it("renders textbox chrome (fill / border) AND body paragraphs", () => {
    // The anchor layer is now the sole text source for anchored
    // textboxes (the legacy lifter that used to emit these into body
    // flow is gone, and `parseAnchoredFrames` claims the drawing so
    // there's no double render). The frame renders its chrome AND its
    // body — via the fallback plain-text renderer when no `renderBody`
    // is injected (as here).
    const frame: AnchoredFrame = pictureFrame({
      content: {
        kind: "textbox",
        body: [
          {
            kind: "paragraph",
            runs: [{ kind: "text", text: "Line 1", properties: {} }],
            properties: {},
          },
          {
            kind: "paragraph",
            runs: [{ kind: "text", text: "Line 2", properties: {} }],
            properties: {},
          },
        ],
        fill: "#eeeeee",
      },
    });
    const layer = renderAnchorLayer([frame], ctx());
    const el = layer.children[0] as HTMLElement;
    const paras = el.querySelectorAll("p");
    expect(paras).toHaveLength(2);
    expect(paras[0]!.textContent).toBe("Line 1");
    expect(paras[1]!.textContent).toBe("Line 2");
    expect(el.style.background).toBe("rgb(238, 238, 238)");
  });

  it("uses the injected renderBody when provided", () => {
    const calls: number[] = [];
    const frame: AnchoredFrame = pictureFrame({
      content: {
        kind: "textbox",
        body: [
          {
            kind: "paragraph",
            runs: [{ kind: "text", text: "X", properties: {} }],
            properties: {},
          },
        ],
      },
    });
    const layer = renderAnchorLayer([frame], {
      ...ctx(),
      renderBody: (blocks: Block[], host: HTMLElement) => {
        calls.push(blocks.length);
        const marker = document.createElement("div");
        marker.className = "custom-rendered";
        host.appendChild(marker);
      },
    });
    const el = layer.children[0] as HTMLElement;
    expect(calls).toEqual([1]);
    expect(el.querySelector(".custom-rendered")).toBeTruthy();
    // Fallback plain-text path NOT used when renderBody is injected.
    expect(el.querySelectorAll("p")).toHaveLength(0);
  });

  it("renders group children scaled into the parent frame's coord space", () => {
    const frame: AnchoredFrame = pictureFrame({
      widthEmu: EMU_PER_MM * 100, // rendered 100mm wide
      heightEmu: EMU_PER_MM * 50, // rendered 50mm tall
      content: {
        kind: "group",
        childCoordSystemCx: EMU_PER_MM * 200, // local 200mm wide → scale 0.5
        childCoordSystemCy: EMU_PER_MM * 100, // local 100mm tall → scale 0.5
        children: [
          {
            id: "g-0",
            anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page" },
            offsetXEmu: EMU_PER_MM * 40,
            offsetYEmu: EMU_PER_MM * 20,
            widthEmu: EMU_PER_MM * 80,
            heightEmu: EMU_PER_MM * 40,
            content: { kind: "shape", geometry: "rect", fill: "#aabbcc" },
          },
        ],
      },
    });
    const layer = renderAnchorLayer([frame], ctx());
    const groupEl = layer.children[0] as HTMLElement;
    const childEl = groupEl.children[0] as HTMLElement;
    // Scale 0.5 applied to every dimension.
    expect(childEl.style.left).toBe("20mm");
    expect(childEl.style.top).toBe("10mm");
    expect(childEl.style.width).toBe("40mm");
    expect(childEl.style.height).toBe("20mm");
  });

  it("subtracts the group's child-coordinate origin (chOff) before scaling", () => {
    // Children measured from a non-zero origin: a child sitting AT the
    // origin must render at the group's top-left (0,0), not at
    // origin × scale. (The IOWA-letterhead displacement bug.)
    const frame: AnchoredFrame = pictureFrame({
      widthEmu: EMU_PER_MM * 100, // rendered 100mm wide
      heightEmu: EMU_PER_MM * 50, // rendered 50mm tall
      content: {
        kind: "group",
        childCoordSystemCx: EMU_PER_MM * 200, // scale 0.5
        childCoordSystemCy: EMU_PER_MM * 100, // scale 0.5
        childCoordOffsetX: EMU_PER_MM * 30,
        childCoordOffsetY: EMU_PER_MM * 10,
        children: [
          {
            id: "g-0",
            anchor: { sectionIndex: 0, horizontalFrom: "page", verticalFrom: "page" },
            offsetXEmu: EMU_PER_MM * 30, // sits exactly on the origin
            offsetYEmu: EMU_PER_MM * 10,
            widthEmu: EMU_PER_MM * 80,
            heightEmu: EMU_PER_MM * 40,
            content: { kind: "shape", geometry: "rect", fill: "#aabbcc" },
          },
        ],
      },
    });
    const layer = renderAnchorLayer([frame], ctx());
    const childEl = (layer.children[0] as HTMLElement).children[0] as HTMLElement;
    // (30−30)×0.5 = 0, (10−10)×0.5 = 0 → top-left.
    expect(childEl.style.left).toBe("0mm");
    expect(childEl.style.top).toBe("0mm");
    // Size still scaled 0.5, unaffected by the origin.
    expect(childEl.style.width).toBe("40mm");
    expect(childEl.style.height).toBe("20mm");
  });

  it("does NOT express behindText via z-index (layer routing owns it)", () => {
    // The overlay layers are isolated stacking contexts ABOVE the body,
    // so an in-layer z-index can never drop a frame below the text —
    // the old `z-index: -1` silently painted behind-text frames ON TOP
    // (visible the moment theme fills resolved). Behind-ness is now the
    // Paper's job: it routes such frames into `.paper-anchors-behind`.
    const layer = renderAnchorLayer([pictureFrame({ behindText: true })], ctx());
    const el = layer.children[0] as HTMLElement;
    expect(el.style.zIndex).toBe("");
  });
});
