import { paginate } from "./paginate";
import type { Box, Glue, Item, Penalty } from "./types";
import { describe, expect, it, vi } from "vitest";

// ---------- helpers ----------

function box(height: number, extra: Partial<Box> = {}): Box {
  return { type: "box", height, ...extra };
}
function glue(height: number): Glue {
  return { type: "glue", height };
}
function penalty(cost: number): Penalty {
  return { type: "penalty", cost };
}

/** N lines of a paragraph with inter-line glue, tagged with paragraphId. */
function paragraph(
  id: string,
  lineCount: number,
  lineHeight: number,
  gap = 0,
  attrs: Partial<Box> = {},
): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < lineCount; i++) {
    items.push(
      box(lineHeight, {
        paragraphId: id,
        isFirstLineOfParagraph: i === 0,
        isLastLineOfParagraph: i === lineCount - 1,
        ...attrs,
      }),
    );
    if (i < lineCount - 1 && gap > 0) items.push(glue(gap));
  }
  return items;
}

function boxCount(items: Item[]): number {
  return items.filter((i) => i.type === "box").length;
}

// ---------- tests ----------

describe("paginate", () => {
  it("1. uniform fill: 100 boxes × 12 on pageHeight=720 → 2 pages (60 + 40)", () => {
    const items = Array.from({ length: 100 }, () => box(12));
    const pages = paginate(items, { pageHeight: 720 });
    expect(pages).toHaveLength(2);
    expect(boxCount(pages[0]!.items)).toBe(60);
    expect(boxCount(pages[1]!.items)).toBe(40);
    expect(pages[0]!.usedHeight).toBe(720);
    expect(pages[1]!.usedHeight).toBe(480);
  });

  it("2. orphan prevention: lone first line at page bottom is pushed to next page", () => {
    // Fill page 1 with P1's 9 single-line paragraphs of 12 each (108). Then
    // room for 600 more. A big single-line paragraph P-filler of 600 takes us
    // to 708 (12 px left on page 1, pageHeight 720). P2 is 3 lines of 12 with
    // 0-height glue between them — so only the first line (12) fits. Without
    // orphan prevention page 1 ends after P2's line 1. With prevention, page 1
    // ends before P2 and P2 lands wholly on page 2.
    const items: Item[] = [
      ...paragraph("filler1", 1, 108),
      glue(0),
      ...paragraph("filler2", 1, 600),
      glue(0),
      ...paragraph("P2", 3, 12, 0),
    ];
    const pages = paginate(items, { pageHeight: 720, orphans: 2, widows: 2 });
    const page1Boxes = pages[0]!.items.filter(
      (i): i is Box => i.type === "box" && i.paragraphId === "P2",
    );
    expect(page1Boxes.length).toBe(0);
    const page2P2 = pages[1]!.items.filter(
      (i): i is Box => i.type === "box" && i.paragraphId === "P2",
    );
    expect(page2P2.length).toBe(3);
  });

  it("3. widow prevention: lone last line at page top pulls previous line along", () => {
    // P1 is 3 lines of 12; pageHeight leaves exactly 2 lines of room. Without
    // widow prevention, page 1 would end with P1's 2 lines and page 2 with
    // P1's line 3 alone. Prevention: push one more line to next page so page
    // 2 has 2 lines of P1.
    // Page 1 filler = 700 (12 px left = less than a line). Actually design:
    // previous content leaves room for exactly 2 lines (24px). Then P1 starts:
    // 2 lines fit on page 1, 3rd line goes to page 2 → widow.
    const items: Item[] = [
      ...paragraph("filler", 1, 696), // 720 - 24 = 696 leaves 24 for P1
      glue(0),
      ...paragraph("P1", 3, 12, 0),
    ];
    const pages = paginate(items, { pageHeight: 720, widows: 2, orphans: 2 });
    // With widow penalty, the breaker should prefer ending page 1 earlier.
    // Specifically: only 1 line (or 0) of P1 on page 1, then 2+ on page 2.
    const p1OnPage1 = pages[0]!.items.filter(
      (i): i is Box => i.type === "box" && i.paragraphId === "P1",
    ).length;
    const p1OnPage2 = pages[1]!.items.filter(
      (i): i is Box => i.type === "box" && i.paragraphId === "P1",
    ).length;
    expect(p1OnPage2).toBeGreaterThanOrEqual(2); // no widow
    expect(p1OnPage1 + p1OnPage2).toBe(3);
  });

  it("4. keep-with-next: a heading moves with the paragraph it precedes", () => {
    // Page 1 filler = 700 (20 px left). Heading = 12 px (fits). Paragraph
    // below is 3 × 12 with the first line needing 12 — only heading + 1 line
    // fit (24 > 20). Without keep-with-next, heading lands alone at page
    // bottom. With keep-with-next, the heading moves to page 2 with the
    // paragraph.
    const items: Item[] = [
      ...paragraph("filler", 1, 700), // 20 left
      glue(0),
      box(12, {
        paragraphId: "H",
        isFirstLineOfParagraph: true,
        isLastLineOfParagraph: true,
        keepWithNext: true,
      }),
      glue(0),
      ...paragraph("P", 3, 12, 0),
    ];
    const pages = paginate(items, { pageHeight: 720 });
    // Heading should NOT be alone on page 1; it should move with P.
    const headingOnPage1 = pages[0]!.items.some((i) => i.type === "box" && i.paragraphId === "H");
    expect(headingOnPage1).toBe(false);
    // Heading should be on the same page as the first line of P.
    const headingPageIdx = pages.findIndex((p) =>
      p.items.some((i) => i.type === "box" && i.paragraphId === "H"),
    );
    const pFirstLinePageIdx = pages.findIndex((p) =>
      p.items.some((i) => i.type === "box" && i.paragraphId === "P"),
    );
    expect(headingPageIdx).toBe(pFirstLinePageIdx);
    expect(headingPageIdx).toBeGreaterThanOrEqual(0);
  });

  it("5. forced break: -Infinity penalty breaks exactly there", () => {
    const items: Item[] = [box(50), box(50), penalty(Number.NEGATIVE_INFINITY), box(50), box(50)];
    const pages = paginate(items, { pageHeight: 720 });
    expect(pages).toHaveLength(2);
    expect(boxCount(pages[0]!.items)).toBe(2);
    expect(pages[0]!.usedHeight).toBe(100);
    expect(boxCount(pages[1]!.items)).toBe(2);
  });

  it("6. monolithic overflow: a 900-tall box gets its own page on pageHeight=720", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const items: Item[] = [box(900, { monolithic: true })];
    const pages = paginate(items, { pageHeight: 720 });
    expect(pages).toHaveLength(1);
    expect(pages[0]!.items).toHaveLength(1);
    expect(pages[0]!.usedHeight).toBe(900);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("7. trailing glue: glue at page end does not count toward usedHeight", () => {
    // Trigger a page break right after some glue. Items 60 boxes × 12 with
    // glue between lines 60 and 61 (which lands at the end of page 1).
    const items: Item[] = [];
    for (let i = 0; i < 100; i++) {
      items.push(box(12));
      if (i === 59) items.push(glue(8)); // trailing glue on page 1
    }
    const pages = paginate(items, { pageHeight: 720 });
    // Page 1 should have 60 boxes + the glue (as an item), but usedHeight
    // excludes the trailing glue.
    expect(boxCount(pages[0]!.items)).toBe(60);
    expect(pages[0]!.items.at(-1)?.type).toBe("glue");
    expect(pages[0]!.usedHeight).toBe(720); // 60 × 12
  });

  it("9. per-page budgets: pageHeights[0]=300 shrinks page 1 only", () => {
    // 100 × 12 boxes = 1200 total. Global pageHeight=720 (60 per page).
    // pageHeights[0]=300 shrinks page 1 to 25 boxes; remaining 75 fall
    // through to subsequent pages at the global 720 budget (60 each).
    // Expected: page 1 has 25, page 2 has 60, page 3 has 15.
    const items = Array.from({ length: 100 }, () => box(12));
    const pages = paginate(items, { pageHeight: 720, pageHeights: [300] });
    expect(pages).toHaveLength(3);
    expect(boxCount(pages[0]!.items)).toBe(25);
    expect(boxCount(pages[1]!.items)).toBe(60);
    expect(boxCount(pages[2]!.items)).toBe(15);
  });

  it("10. per-page budgets: undefined entries fall back to global pageHeight", () => {
    // Same setup as test 9 but with pageHeights sparse — only entry 1
    // (page 2) is overridden to 120 (10 boxes). Page 0 uses global
    // (60 boxes), page 1 uses 120 (10), page 2+ uses global again.
    // 60 + 10 + 30 = 100 boxes across 3 pages.
    const items = Array.from({ length: 100 }, () => box(12));
    const pages = paginate(items, {
      pageHeight: 720,
      pageHeights: [720, 120],
    });
    expect(pages).toHaveLength(3);
    expect(boxCount(pages[0]!.items)).toBe(60);
    expect(boxCount(pages[1]!.items)).toBe(10);
    expect(boxCount(pages[2]!.items)).toBe(30);
  });

  it("8. keep-together: a 10-line paragraph near page bottom moves entirely to next page", () => {
    // Page 1 pre-filler leaves exactly 4 lines of room (48 / 12). Then a
    // keepTogether paragraph of 10 × 12 (120 total) — doesn't fit in 48.
    // It should move entirely to the next page.
    const items: Item[] = [
      ...paragraph("filler", 1, 672), // 720 - 48 = 672
      glue(0),
      ...paragraph("KT", 10, 12, 0, { keepTogether: true }),
    ];
    const pages = paginate(items, { pageHeight: 720 });
    const page1KT = pages[0]!.items.filter(
      (i): i is Box => i.type === "box" && i.paragraphId === "KT",
    ).length;
    const page2KT = pages[1]!.items.filter(
      (i): i is Box => i.type === "box" && i.paragraphId === "KT",
    ).length;
    expect(page1KT).toBe(0);
    expect(page2KT).toBe(10);
  });
});
