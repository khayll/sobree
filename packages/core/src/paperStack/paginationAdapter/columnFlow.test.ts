import { afterEach, describe, expect, it } from "vitest";
import { flowUnequalColumnSections } from "./columnFlow";

/** A `.sobree-col`'s height is the sum of its children's stubbed heights;
 *  jsdom can't lay out, so model it on the prototype for the duration of
 *  a test (paragraphs carry their own stubbed `offsetHeight`). */
function installColHeightModel(): void {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains("sobree-col")) {
        // paragraphs get an explicit value via stub(); default 0.
        return 0;
      }
      return Array.from(this.children).reduce((s, c) => s + (c as HTMLElement).offsetHeight, 0);
    },
  });
}

function stub(el: Element, px: number): void {
  Object.defineProperty(el, "offsetHeight", { value: px, configurable: true });
}

/** A root containing one unequal-column wrapper with `blockPx`-tall blocks. */
function rootWith(widthsMm: string, gapsMm: string, blockPx: number[]): HTMLElement {
  const root = document.createElement("div");
  const w = document.createElement("div");
  w.className = "sobree-cols-unequal";
  w.dataset.colWidthsMm = widthsMm;
  w.dataset.colGapsMm = gapsMm;
  blockPx.forEach((h, i) => {
    const p = document.createElement("p");
    p.textContent = `b${i}`;
    stub(p, h);
    w.appendChild(p);
  });
  root.appendChild(w);
  return root;
}

afterEach(() => {
  delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight;
});

describe("flowUnequalColumnSections", () => {
  it("builds explicit-width tracks and fills track 0 to the budget, spilling the rest", () => {
    installColHeightModel();
    // 6 blocks × 100px, budget 300px → track 0 holds 3, track 1 the rest.
    const root = rootWith("116,52", "13", Array(6).fill(100));
    flowUnequalColumnSections(root, 300);

    const cols = root.querySelectorAll(".sobree-col");
    expect(cols.length).toBe(2);
    expect((cols[0] as HTMLElement).style.width).toBe("116mm");
    expect((cols[1] as HTMLElement).style.width).toBe("52mm");
    expect(cols[0]!.childElementCount).toBe(3);
    expect(cols[1]!.childElementCount).toBe(3);
    // document order preserved across the split.
    expect(cols[0]!.children[0]!.textContent).toBe("b0");
    expect(cols[1]!.children[0]!.textContent).toBe("b3");
  });

  it("is idempotent — re-running re-flattens and re-fills to the same result", () => {
    installColHeightModel();
    const root = rootWith("100,100", "10", Array(4).fill(100));
    flowUnequalColumnSections(root, 200);
    flowUnequalColumnSections(root, 200);
    const cols = root.querySelectorAll(".sobree-col");
    expect(cols.length).toBe(2); // not nested twice
    expect(cols[0]!.childElementCount).toBe(2);
    expect(cols[1]!.childElementCount).toBe(2);
  });

  it("ignores wrappers with fewer than two column widths", () => {
    const root = rootWith("100", "", [50, 50]);
    flowUnequalColumnSections(root, 100);
    expect(root.querySelectorAll(".sobree-col").length).toBe(0);
    expect(root.querySelector(".sobree-cols-unequal")!.childElementCount).toBe(2); // untouched
  });
});
