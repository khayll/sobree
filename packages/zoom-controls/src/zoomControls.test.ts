import { describe, expect, it, vi } from "vitest";
import { ZoomControls } from "./zoomControls";
import type { Viewport } from "@sobree/core";

interface FakeViewport {
  container: HTMLElement;
  getScale: () => number;
  zoomTo: ReturnType<typeof vi.fn>;
  fitTo: ReturnType<typeof vi.fn>;
}

function makeViewport(container: HTMLElement, scale = 1): FakeViewport {
  Object.defineProperty(container, "getBoundingClientRect", {
    value: () => ({
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    configurable: true,
  });
  return {
    container,
    getScale: () => scale,
    zoomTo: vi.fn(),
    fitTo: vi.fn(),
  };
}

describe("ZoomControls", () => {
  it("renders the four-button dock and exposes the buttons", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const vp = makeViewport(container);
    const target = document.createElement("div");

    const dock = new ZoomControls({
      container,
      viewport: vp as unknown as Viewport,
      fitWidthTarget: target,
      fitPageTarget: target,
    });

    const actions = Array.from(
      dock.root.querySelectorAll<HTMLButtonElement>("button[data-zc-action]"),
    ).map((b) => b.getAttribute("data-zc-action"));
    expect(actions).toEqual(["fit-page", "fit-width", "zoom-out", "zoom-in"]);
    dock.destroy();
  });

  it("zoom-in multiplies and zoom-out divides by zoomFactor", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const vp = makeViewport(container, 1);
    const target = document.createElement("div");

    const dock = new ZoomControls({
      container,
      viewport: vp as unknown as Viewport,
      fitWidthTarget: target,
      fitPageTarget: target,
      zoomFactor: 2,
    });

    dock.root
      .querySelector<HTMLButtonElement>('button[data-zc-action="zoom-in"]')!
      .click();
    expect(vp.zoomTo).toHaveBeenLastCalledWith(2, 100, 50);

    dock.root
      .querySelector<HTMLButtonElement>('button[data-zc-action="zoom-out"]')!
      .click();
    expect(vp.zoomTo).toHaveBeenLastCalledWith(0.5, 100, 50);
    dock.destroy();
  });

  it("fit-width and fit-page resolve dynamic targets at click time", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const vp = makeViewport(container);
    const widthTarget = document.createElement("div");
    const pageTarget = document.createElement("div");

    const widthResolver = vi.fn(() => widthTarget);
    const pageResolver = vi.fn(() => pageTarget);

    const dock = new ZoomControls({
      container,
      viewport: vp as unknown as Viewport,
      fitWidthTarget: widthResolver,
      fitPageTarget: pageResolver,
    });

    dock.root
      .querySelector<HTMLButtonElement>('button[data-zc-action="fit-width"]')!
      .click();
    expect(widthResolver).toHaveBeenCalledOnce();
    expect(vp.fitTo).toHaveBeenLastCalledWith(widthTarget, "width", true);

    dock.root
      .querySelector<HTMLButtonElement>('button[data-zc-action="fit-page"]')!
      .click();
    expect(pageResolver).toHaveBeenCalledOnce();
    expect(vp.fitTo).toHaveBeenLastCalledWith(pageTarget, "contain", true);
    dock.destroy();
  });

  it("defaults placement to bottom-right and reflects it on data-placement", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const vp = makeViewport(container);
    const target = document.createElement("div");

    const dock = new ZoomControls({
      container,
      viewport: vp as unknown as Viewport,
      fitWidthTarget: target,
      fitPageTarget: target,
    });
    expect(dock.root.getAttribute("data-placement")).toBe("bottom-right");
    dock.destroy();
  });

  it("respects an explicit placement", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const vp = makeViewport(container);
    const target = document.createElement("div");

    const dock = new ZoomControls({
      container,
      viewport: vp as unknown as Viewport,
      fitWidthTarget: target,
      fitPageTarget: target,
      placement: "top-left",
    });
    expect(dock.root.getAttribute("data-placement")).toBe("top-left");
    dock.destroy();
  });

  it("destroy removes the dock element from the DOM", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const vp = makeViewport(container);
    const target = document.createElement("div");

    const dock = new ZoomControls({
      container,
      viewport: vp as unknown as Viewport,
      fitWidthTarget: target,
      fitPageTarget: target,
    });

    expect(container.contains(dock.root)).toBe(true);
    dock.destroy();
    expect(container.contains(dock.root)).toBe(false);
  });
});
