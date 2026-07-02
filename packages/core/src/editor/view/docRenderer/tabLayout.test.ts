import { describe, expect, it } from "vitest";

import type { InlineRun, Paragraph, ParagraphProperties } from "../../../doc/types";
import { renderParagraph } from "./paragraph";
import { planRightTailTab } from "./tabLayout";

const text = (t: string): InlineRun => ({ kind: "text", text: t, properties: {} });

function para(runs: InlineRun[], properties: ParagraphProperties = {}): Paragraph {
  return { kind: "paragraph", properties, runs };
}

/** The wsu-thesis TOC shape: right stop with dot leader at the 6.5in
 *  text-column edge (9360 twips), one tab between entry and number. */
const RIGHT_DOT_STOP: ParagraphProperties = {
  tabStops: [{ positionTwips: 9360, alignment: "right", leader: "dot" }],
};

describe("planRightTailTab", () => {
  it("splits entry / page number at the single tab and maps the dot leader", () => {
    const plan = planRightTailTab(
      para([text("ACKNOWLEDGMENT"), text("\t"), text("iii")], RIGHT_DOT_STOP),
      RIGHT_DOT_STOP,
    );
    expect(plan).not.toBeNull();
    expect(plan!.before).toEqual([text("ACKNOWLEDGMENT")]);
    expect(plan!.after).toEqual([text("iii")]);
    expect(plan!.leaderFill).toMatch(/^\.+$/);
    // 9360 twips = 165.1mm (sub-twip exact conversion): the stop sits at
    // the column edge, so the calc resolves to ~0 in the browser.
    expect(plan!.tailMarginRight).toBe("calc(100% - 165.1mm)");
  });

  it("splits inside a single text run carrying the tab", () => {
    const plan = planRightTailTab(para([text("Entry\t42")], RIGHT_DOT_STOP), RIGHT_DOT_STOP);
    expect(plan!.before).toEqual([text("Entry")]);
    expect(plan!.after).toEqual([text("42")]);
  });

  it("omits the leader fill when the stop declares none", () => {
    const props: ParagraphProperties = {
      tabStops: [{ positionTwips: 9360, alignment: "right" }],
    };
    const plan = planRightTailTab(para([text("Entry\t42")], props), props);
    expect(plan).not.toBeNull();
    expect(plan!.leaderFill).toBeUndefined();
  });

  it("subtracts the left indent from the stop position (w:pos is margin-relative)", () => {
    const props: ParagraphProperties = {
      ...RIGHT_DOT_STOP,
      indent: { leftTwips: 720 },
    };
    const plan = planRightTailTab(para([text("Entry\t42")], props), props);
    expect(plan!.tailMarginRight).toBe("calc(100% - 152.4mm)"); // (9360-720)tw = 152.4mm exact
  });

  it("carries the first-line indent as before-span margin (flex ignores text-indent)", () => {
    const firstLine: ParagraphProperties = {
      ...RIGHT_DOT_STOP,
      indent: { firstLineTwips: 720 },
    };
    expect(
      planRightTailTab(para([text("Entry\t42")], firstLine), firstLine)!.beforeMarginLeft,
    ).toBe("12.7mm");
    const hanging: ParagraphProperties = { ...RIGHT_DOT_STOP, indent: { hangingTwips: 360 } };
    expect(planRightTailTab(para([text("Entry\t42")], hanging), hanging)!.beforeMarginLeft).toBe(
      "-6.35mm",
    );
  });

  it("ignores cleared stops when picking the trailing stop", () => {
    const props: ParagraphProperties = {
      tabStops: [
        { positionTwips: 9360, alignment: "right", leader: "dot" },
        { positionTwips: 10000, alignment: "clear" },
      ],
    };
    expect(planRightTailTab(para([text("Entry\t42")], props), props)).not.toBeNull();
  });

  it("bails without stops, or when the farthest stop is not right-aligned", () => {
    expect(planRightTailTab(para([text("Entry\t42")]), {})).toBeNull();
    const leftLast: ParagraphProperties = {
      tabStops: [
        { positionTwips: 4680, alignment: "right" },
        { positionTwips: 9360, alignment: "left" },
      ],
    };
    expect(planRightTailTab(para([text("Entry\t42")], leftLast), leftLast)).toBeNull();
  });

  it("bails on two tabs, a tab inside a hyperlink, or an empty tail", () => {
    expect(planRightTailTab(para([text("A\tB\tC")], RIGHT_DOT_STOP), RIGHT_DOT_STOP)).toBeNull();
    const linked = para(
      [{ kind: "hyperlink", href: "#", children: [text("A\t1")] }],
      RIGHT_DOT_STOP,
    );
    expect(planRightTailTab(linked, RIGHT_DOT_STOP)).toBeNull();
    expect(
      planRightTailTab(para([text("Entry\t"), text("  ")], RIGHT_DOT_STOP), RIGHT_DOT_STOP),
    ).toBeNull();
  });
});

describe("renderParagraph right-tail spread", () => {
  it("renders before / leader / after spans; the leader is view-only chrome", () => {
    const el = renderParagraph(
      para([text("ACKNOWLEDGMENT"), text("\t"), text("iii")], RIGHT_DOT_STOP),
      [],
      {},
    );
    expect(el.classList.contains("sobree-tab-spread")).toBe(true);
    const [before, sep, leader, after] = Array.from(el.children) as HTMLElement[];
    expect(before!.className).toBe("sobree-tab-spread__before");
    expect(before!.textContent).toBe("ACKNOWLEDGMENT");
    // The tab character STAYS in the DOM (zero-width span) — the flex
    // layout carries the geometry, but the document text must survive:
    // copy/paste, the DOM→AST serializer, and the corpus text-matcher
    // all read it (dropping it unmatched every spread line of
    // pentest-engineer).
    expect(sep!.className).toBe("sobree-tab-spread__sep");
    expect(sep!.textContent).toBe("\t");
    expect(leader!.className).toBe("sobree-tab-spread__leader");
    expect(leader!.getAttribute("contenteditable")).toBe("false");
    expect(leader!.getAttribute("aria-hidden")).toBe("true");
    expect(leader!.textContent).toMatch(/^\.+$/);
    expect(after!.className).toBe("sobree-tab-spread__after");
    expect(after!.textContent).toBe("iii");
    expect(el.textContent).toContain("ACKNOWLEDGMENT\t");
  });

  it("renders no leader span when the stop declares no leader", () => {
    const props: ParagraphProperties = {
      tabStops: [{ positionTwips: 9360, alignment: "right" }],
    };
    const el = renderParagraph(para([text("Entry\t42")], props), [], {});
    expect(el.children).toHaveLength(3); // before, sep, after
    expect(el.querySelector(".sobree-tab-spread__leader")).toBeNull();
    expect(el.textContent).toBe("Entry\t42");
  });

  it("keeps the tab-size fallback for paragraphs the plan rejects", () => {
    const props: ParagraphProperties = {
      tabStops: [{ positionTwips: 9360, alignment: "right", leader: "dot" }],
    };
    const el = renderParagraph(para([text("A\tB\tC")], props), [], {});
    expect(el.classList.contains("sobree-tab-spread")).toBe(false);
    expect(el.textContent).toBe("A\tB\tC");
  });
});
