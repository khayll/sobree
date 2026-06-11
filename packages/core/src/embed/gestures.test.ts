import { describe, expect, it } from "vitest";
import { TouchGestures } from "./touchGestures";
import { WheelGestures } from "./wheelGestures";
import type { GestureHost } from "./gestureHost";

/** Recording host stub — the controllers' entire output surface. */
function makeHost(scale = 1) {
  const calls: { pans: [number, number][]; zooms: [number, number, number][] } = {
    pans: [],
    zooms: [],
  };
  const host: GestureHost = {
    panBy: (dx, dy) => calls.pans.push([dx, dy]),
    zoomTo: (s, x, y) => {
      calls.zooms.push([s, x, y]);
      scale = s;
    },
    getScale: () => scale,
  };
  return { host, calls };
}

/** jsdom has no PointerEvent — synthesize one from MouseEvent. */
function pointer(
  type: string,
  id: number,
  x: number,
  y: number,
  pointerType = "touch",
): MouseEvent {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(e, "pointerId", { value: id });
  Object.defineProperty(e, "pointerType", { value: pointerType });
  return e;
}

function wheel(opts: Partial<WheelEventInit>): WheelEvent {
  return new WheelEvent("wheel", { bubbles: true, cancelable: true, ...opts });
}

const totalPan = (pans: [number, number][]): [number, number] =>
  pans.reduce(([x, y], [dx, dy]) => [x + dx, y + dy], [0, 0]);

describe("TouchGestures", () => {
  const setup = (scale = 1) => {
    const container = document.createElement("div");
    const { host, calls } = makeHost(scale);
    const gestures = new TouchGestures(container, host);
    return { container, calls, gestures };
  };

  it("a tap within the slop radius never pans (caret placement must work)", () => {
    const { container, calls } = setup();
    container.dispatchEvent(pointer("pointerdown", 1, 100, 100));
    container.dispatchEvent(pointer("pointermove", 1, 103, 102));
    container.dispatchEvent(pointer("pointerup", 1, 103, 102));
    expect(calls.pans).toEqual([]);
    expect(calls.zooms).toEqual([]);
  });

  it("one-finger drag past the slop pans by the move deltas", () => {
    const { container, calls } = setup();
    container.dispatchEvent(pointer("pointerdown", 1, 100, 100));
    container.dispatchEvent(pointer("pointermove", 1, 100, 80)); // past slop → pan engages
    container.dispatchEvent(pointer("pointermove", 1, 100, 60));
    container.dispatchEvent(pointer("pointerup", 1, 100, 60));
    expect(totalPan(calls.pans)).toEqual([0, -40]);
    expect(calls.zooms).toEqual([]);
  });

  it("mouse drag is ignored — that's text selection, not pan", () => {
    const { container, calls } = setup();
    container.dispatchEvent(pointer("pointerdown", 1, 100, 100, "mouse"));
    container.dispatchEvent(pointer("pointermove", 1, 200, 200, "mouse"));
    container.dispatchEvent(pointer("pointerup", 1, 200, 200, "mouse"));
    expect(calls.pans).toEqual([]);
  });

  it("pinch scales by the finger-distance ratio, anchored at the midpoint", () => {
    const { container, calls } = setup(1);
    container.dispatchEvent(pointer("pointerdown", 1, 200, 250));
    container.dispatchEvent(pointer("pointerdown", 2, 200, 350)); // dist 100
    container.dispatchEvent(pointer("pointermove", 1, 200, 150));
    container.dispatchEvent(pointer("pointermove", 2, 200, 450)); // dist 300
    const [s, , midY] = calls.zooms.at(-1)!;
    expect(s).toBeCloseTo(3); // 1 × 300/100
    expect(midY).toBeCloseTo(300);
  });

  it("pinch collapsing to one finger continues as a pan, re-anchored", () => {
    const { container, calls } = setup();
    container.dispatchEvent(pointer("pointerdown", 1, 200, 200));
    container.dispatchEvent(pointer("pointerdown", 2, 300, 200));
    container.dispatchEvent(pointer("pointerup", 2, 300, 200));
    calls.pans.length = 0;
    container.dispatchEvent(pointer("pointermove", 1, 210, 200));
    expect(totalPan(calls.pans)).toEqual([10, 0]);
  });

  it("swallows the synthetic click after a pan, but not a genuine tap's click", () => {
    const { container } = setup();
    let clicks = 0;
    const target = document.createElement("span");
    container.appendChild(target);
    target.addEventListener("click", () => clicks++);

    // drag, then the browser-synthetic click
    container.dispatchEvent(pointer("pointerdown", 1, 100, 100));
    container.dispatchEvent(pointer("pointermove", 1, 100, 50));
    container.dispatchEvent(pointer("pointerup", 1, 100, 50));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicks).toBe(0);

    // a fresh tap afterwards must click through
    container.dispatchEvent(pointer("pointerdown", 1, 120, 100));
    container.dispatchEvent(pointer("pointerup", 1, 120, 100));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(clicks).toBe(1);
  });

  it("destroy detaches all listeners", () => {
    const { container, calls, gestures } = setup();
    gestures.destroy();
    container.dispatchEvent(pointer("pointerdown", 1, 100, 100));
    container.dispatchEvent(pointer("pointermove", 1, 100, 50));
    expect(calls.pans).toEqual([]);
  });
});

describe("WheelGestures", () => {
  const setup = (scale = 1) => {
    const container = document.createElement("div");
    const { host, calls } = makeHost(scale);
    const gestures = new WheelGestures(container, host, {
      wheelZoomSensitivity: 0.005,
      pinchZoomSensitivity: 0.02,
    });
    return { container, calls, gestures };
  };

  it("bare wheel pans opposite to the scroll deltas", () => {
    const { container, calls } = setup();
    container.dispatchEvent(wheel({ deltaX: 0, deltaY: 50 }));
    expect(totalPan(calls.pans)).toEqual([0, -50]);
    expect(calls.zooms).toEqual([]);
  });

  it("ctrl+wheel (trackpad pinch) zooms multiplicatively at the cursor", () => {
    const { container, calls } = setup(2);
    container.dispatchEvent(wheel({ deltaY: -10, ctrlKey: true, clientX: 40, clientY: 60 }));
    const [s, x, y] = calls.zooms[0]!;
    expect(s).toBeCloseTo(2 * Math.exp(0.2)); // exp(-(-10) × 0.02)
    expect([x, y]).toEqual([40, 60]);
    expect(calls.pans).toEqual([]);
  });

  it("near-vertical scroll locks the axis: sideways wobble is zeroed", () => {
    const { container, calls } = setup();
    container.dispatchEvent(wheel({ deltaX: 1, deltaY: 40 })); // y dominates → lock y
    container.dispatchEvent(wheel({ deltaX: 5, deltaY: 40 })); // wobble dx zeroed
    const [dx, dy] = totalPan(calls.pans);
    expect(dx).toBe(0);
    expect(dy).toBe(-80);
  });

  it("fitTo's horizontal lock holds until sustained sideways motion releases it", () => {
    const { container, calls, gestures } = setup();
    gestures.engageHorizontalLock();
    container.dispatchEvent(wheel({ deltaX: 30, deltaY: 0 })); // locked: dx zeroed
    expect(totalPan(calls.pans)).toEqual([0, 0]);
    container.dispatchEvent(wheel({ deltaX: 30, deltaY: 0 })); // signed dx hits 60 → release
    expect(totalPan(calls.pans)).toEqual([-30, 0]); // this event's dx passes through
  });
});
