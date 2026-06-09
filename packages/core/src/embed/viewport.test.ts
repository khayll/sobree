import { beforeEach, describe, expect, it, vi } from "vitest";
import { Viewport } from "./viewport";

/**
 * jsdom has no `PointerEvent` constructor, so synthesize a plain Event and
 * graft on the fields the viewport's handlers read. `getBoundingClientRect`
 * defaults to all-zeros in jsdom, which is fine — the gesture math only uses
 * `rect.left` / `rect.top` (both 0).
 */
function pointer(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  opts: { id: number; x: number; y: number; pointerType?: string },
): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, {
    pointerType: opts.pointerType ?? "touch",
    pointerId: opts.id,
    clientX: opts.x,
    clientY: opts.y,
  });
  return e;
}

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  // jsdom doesn't implement pointer capture; the viewport guards with `?.`
  // but defining no-ops keeps the calls inert here.
  Object.assign(container, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
  document.body.appendChild(container);
  return container;
}

function stageTransform(container: HTMLElement): string {
  const stage = container.querySelector<HTMLElement>(".sobree-viewport__stage");
  return stage?.style.transform ?? "";
}

describe("Viewport touch gestures", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("pans the stage on a one-finger drag", () => {
    const container = makeContainer();
    const vp = new Viewport(container);

    container.dispatchEvent(pointer("pointerdown", { id: 1, x: 10, y: 10 }));
    container.dispatchEvent(pointer("pointermove", { id: 1, x: 30, y: 25 }));

    // Dragged +20 right, +15 down → stage translates by the same amount.
    expect(stageTransform(container)).toContain("translate3d(20px, 15px, 0)");
    expect(vp.getScale()).toBe(1);
  });

  it("pinch-zooms about the finger midpoint", () => {
    const container = makeContainer();
    const onScaleChange = vi.fn();
    const vp = new Viewport(container, { onScaleChange });

    // Two fingers 100px apart, midpoint (50,0).
    container.dispatchEvent(pointer("pointerdown", { id: 1, x: 0, y: 0 }));
    container.dispatchEvent(pointer("pointerdown", { id: 2, x: 100, y: 0 }));
    // Spread the second finger to 200px apart → 2× the spread → 2× scale.
    container.dispatchEvent(pointer("pointermove", { id: 2, x: 200, y: 0 }));

    expect(vp.getScale()).toBeCloseTo(2);
    expect(onScaleChange).toHaveBeenLastCalledWith(2);
  });

  it("clamps pinch zoom to maxScale", () => {
    const container = makeContainer();
    const vp = new Viewport(container, { maxScale: 1.5 });

    container.dispatchEvent(pointer("pointerdown", { id: 1, x: 0, y: 0 }));
    container.dispatchEvent(pointer("pointerdown", { id: 2, x: 100, y: 0 }));
    container.dispatchEvent(pointer("pointermove", { id: 2, x: 400, y: 0 }));

    expect(vp.getScale()).toBe(1.5);
  });

  it("ignores non-touch pointers so the wheel path keeps trackpads", () => {
    const container = makeContainer();
    const vp = new Viewport(container);
    const before = stageTransform(container);

    container.dispatchEvent(pointer("pointerdown", { id: 1, x: 10, y: 10, pointerType: "mouse" }));
    container.dispatchEvent(pointer("pointermove", { id: 1, x: 80, y: 80, pointerType: "mouse" }));

    expect(stageTransform(container)).toBe(before);
    expect(vp.getScale()).toBe(1);
  });

  it("stops panning once the finger lifts", () => {
    const container = makeContainer();
    new Viewport(container);

    container.dispatchEvent(pointer("pointerdown", { id: 1, x: 0, y: 0 }));
    container.dispatchEvent(pointer("pointermove", { id: 1, x: 40, y: 0 }));
    container.dispatchEvent(pointer("pointerup", { id: 1, x: 40, y: 0 }));
    // A stray move after lift must not pan (no tracked pointer).
    container.dispatchEvent(pointer("pointermove", { id: 1, x: 999, y: 0 }));

    expect(stageTransform(container)).toContain("translate3d(40px, 0px, 0)");
  });
});
