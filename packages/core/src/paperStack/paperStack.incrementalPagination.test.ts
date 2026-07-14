import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PAGE_SETUP } from "../doc/pageSetup";
import { PaperStack } from "./paperStack";

/**
 * Integration guard for the incremental-pagination fast path (PR 3a of
 * `devdocs/plan-model-first-editing.md`): `repaginate` must SKIP the full
 * re-flow when the edit moved no page break, and must fall through to it when
 * anything about the layout actually changed.
 *
 * `corpus:pages` can't cover this — it paginates each fixture ONCE, so it
 * never exercises the arm→edit→skip cycle the fast path lives in.
 *
 * The deterministic signal (following `feature.renderReuse`'s node-identity
 * proxy over flaky wall-clock timing): `runPaginationOnce` — the private
 * consolidate→measure→distribute pass — runs on a real re-flow and NEVER on a
 * skip. Spying on it tells the two paths apart exactly.
 */

const doc = window.document;

// jsdom has no layout, so we model heights: paper CARDS report a fixed page
// height (below) — enough that `pageContentHeightPx` and the footnote-budget
// trim resolve to one clean pagination pass — while block elements carry their
// own stubbed `offsetHeight` (a per-element property that shadows this getter).
const PAGE_PX = 1000;
let originalOffsetHeight: PropertyDescriptor | undefined;
let container: HTMLElement;
let stack: PaperStack;

beforeEach(() => {
  originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("paper") ? PAGE_PX : 0;
    },
  });
  container = doc.createElement("div");
  doc.body.appendChild(container);
  stack = new PaperStack(container, DEFAULT_PAGE_SETUP);
});

afterEach(() => {
  stack.destroy();
  container.remove();
  if (originalOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
  } else {
    delete (HTMLElement.prototype as unknown as { offsetHeight?: unknown }).offsetHeight;
  }
  vi.restoreAllMocks();
});

/** Append `count` single-line paragraphs of `heightPx` into paper 0's content,
 *  each tall enough that a few span more than one page. */
function seedBlocks(count: number, heightPx: number): HTMLElement[] {
  const els: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const p = doc.createElement("p");
    p.textContent = `Paragraph ${i}`;
    Object.defineProperty(p, "offsetHeight", { value: heightPx, configurable: true });
    stack.primaryContent.appendChild(p);
    els.push(p);
  }
  return els;
}

function setHeight(el: HTMLElement, px: number): void {
  Object.defineProperty(el, "offsetHeight", { value: px, configurable: true });
}

describe("incremental pagination — repaginate skip", () => {
  it("splits enough blocks across pages to make the test meaningful", () => {
    seedBlocks(8, 300);
    stack.repaginate();
    // Sanity: the seed genuinely paginates to more than one page, so a skip is
    // actually preserving a non-trivial multi-page layout.
    expect(stack.getPageCount()).toBeGreaterThan(1);
  });

  it("skips the re-flow when nothing changed (arm → no-op → skip)", () => {
    seedBlocks(8, 300);
    stack.repaginate(); // arm the snapshot
    const spy = vi.spyOn(
      stack as unknown as { runPaginationOnce: () => void },
      "runPaginationOnce",
    );
    stack.repaginate(); // nothing changed
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips when a block's text changed but its height did not (the typing case)", () => {
    const blocks = seedBlocks(8, 300);
    stack.repaginate();
    const spy = vi.spyOn(
      stack as unknown as { runPaginationOnce: () => void },
      "runPaginationOnce",
    );
    // A character typed in place that didn't wrap: same node, same height.
    blocks[2]!.textContent = "Paragraph 2 edited";
    stack.repaginate();
    expect(spy).not.toHaveBeenCalled();
  });

  it("re-flows when a block's height changed (a line wrapped)", () => {
    const blocks = seedBlocks(8, 300);
    stack.repaginate();
    const spy = vi.spyOn(
      stack as unknown as { runPaginationOnce: () => void },
      "runPaginationOnce",
    );
    setHeight(blocks[2]!, 600); // grew by a line — may push a break
    stack.repaginate();
    expect(spy).toHaveBeenCalled();
  });

  it("re-flows when a block node was replaced (an API re-render)", () => {
    const blocks = seedBlocks(8, 300);
    stack.repaginate();
    const spy = vi.spyOn(
      stack as unknown as { runPaginationOnce: () => void },
      "runPaginationOnce",
    );
    // Swap block 2's node for a fresh one of the same height — what a commit()
    // re-render produces. Reference identity differs ⇒ must re-flow.
    const fresh = doc.createElement("p");
    fresh.textContent = "Paragraph 2";
    setHeight(fresh, 300);
    blocks[2]!.replaceWith(fresh);
    stack.repaginate();
    expect(spy).toHaveBeenCalled();
  });

  it("re-flows when a block was inserted (structural change)", () => {
    seedBlocks(8, 300);
    stack.repaginate();
    const spy = vi.spyOn(
      stack as unknown as { runPaginationOnce: () => void },
      "runPaginationOnce",
    );
    const extra = doc.createElement("p");
    extra.textContent = "inserted";
    setHeight(extra, 300);
    stack.primaryContent.appendChild(extra);
    stack.repaginate();
    expect(spy).toHaveBeenCalled();
  });

  it("re-flows when the page setup (budget) changed", () => {
    seedBlocks(8, 300);
    stack.repaginate();
    const spy = vi.spyOn(
      stack as unknown as { runPaginationOnce: () => void },
      "runPaginationOnce",
    );
    // `margins.bottom` feeds the budget directly (nominalBottom); a bigger
    // bottom margin shrinks the page budget, which must force a re-flow.
    stack.updateSetup({
      ...DEFAULT_PAGE_SETUP,
      margins: { ...DEFAULT_PAGE_SETUP.margins, bottom: 120 },
    });
    expect(spy).toHaveBeenCalled();
  });
});
