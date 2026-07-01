import { describe, expect, it } from "vitest";
import type { BreakRun, DrawingRun, FieldRun, HyperlinkRun, InlineRun, TabRun } from "../doc/types";
import {
  type DeltaOp,
  attrsToRunProps,
  deepEqual,
  deltaToRuns,
  runPropsToAttrs,
  runsToDelta,
} from "./runs";

function rt(runs: InlineRun[]): InlineRun[] {
  return deltaToRuns(runsToDelta(runs));
}

describe("runs ↔ delta — round trip", () => {
  it("plain text", () => {
    const runs: InlineRun[] = [{ kind: "text", text: "Hello, world.", properties: {} }];
    expect(rt(runs)).toEqual(runs);
  });

  it("text with marks", () => {
    const runs: InlineRun[] = [
      {
        kind: "text",
        text: "Bold red.",
        properties: { bold: true, color: "#f00" },
      },
    ];
    expect(rt(runs)).toEqual(runs);
  });

  it("multiple text runs preserve order + per-run marks", () => {
    const runs: InlineRun[] = [
      { kind: "text", text: "Hello, ", properties: {} },
      { kind: "text", text: "world", properties: { bold: true } },
      { kind: "text", text: ".", properties: {} },
    ];
    expect(rt(runs)).toEqual(runs);
  });

  it("break run (line) round-trips with no properties", () => {
    const br: BreakRun = { kind: "break", type: "line" };
    expect(rt([br])).toEqual([br]);
  });

  it("break run (page) preserves properties", () => {
    const br: BreakRun = {
      kind: "break",
      type: "page",
      properties: { bold: true },
    };
    expect(rt([br])).toEqual([br]);
  });

  it("tab run round-trips", () => {
    const tab: TabRun = { kind: "tab" };
    expect(rt([tab])).toEqual([tab]);
  });

  it("footnote ref round-trips its custom mark (Y.Doc parity — refresh must not drop it)", () => {
    const auto: InlineRun = { kind: "footnoteRef", id: 3 };
    const custom: InlineRun = { kind: "footnoteRef", id: 1, customMark: "*" };
    expect(rt([auto])).toEqual([auto]);
    expect(rt([custom])).toEqual([custom]);
  });

  it("field run preserves instruction + cached", () => {
    const f: FieldRun = {
      kind: "field",
      instruction: "PAGE",
      cached: "1",
    };
    expect(rt([f])).toEqual([f]);
  });

  it("drawing run preserves all fields", () => {
    const d: DrawingRun = {
      kind: "drawing",
      partPath: "word/media/image1.png",
      widthEmu: 1000000,
      heightEmu: 750000,
      altText: "diagram",
      placement: "inline",
    };
    expect(rt([d])).toEqual([d]);
  });

  it("float drawing round-trips its margins (Y.Doc parity — refresh must not drop them)", () => {
    const d: DrawingRun = {
      kind: "drawing",
      partPath: "word/media/photo.png",
      widthEmu: 1168400,
      heightEmu: 1168400,
      placement: "floatRight",
      floatMarginsEmu: { topEmu: 152400, rightEmu: 152400, bottomEmu: 152400, leftEmu: 152400 },
      verticalAlign: "middle",
    };
    expect(rt([d])).toEqual([d]);
  });

  it("anchored drawing round-trips its anchor", () => {
    const d: DrawingRun = {
      kind: "drawing",
      partPath: "word/media/logo.png",
      widthEmu: 500000,
      heightEmu: 500000,
      placement: "anchor",
      anchor: {
        offsetXEmu: 914400,
        offsetYEmu: 457200,
        relativeFromH: "margin",
        relativeFromV: "paragraph",
        behindDoc: true,
      },
    };
    expect(rt([d])).toEqual([d]);
  });

  it("drawing run without altText omits the field", () => {
    const d: DrawingRun = {
      kind: "drawing",
      partPath: "word/media/img.png",
      widthEmu: 100,
      heightEmu: 100,
      placement: "inline",
    };
    const out = rt([d]);
    expect(out).toEqual([d]);
    expect((out[0] as DrawingRun).altText).toBeUndefined();
  });

  it("hyperlink with one text child", () => {
    const link: HyperlinkRun = {
      kind: "hyperlink",
      href: "https://example.com",
      children: [{ kind: "text", text: "click me", properties: {} }],
    };
    expect(rt([link])).toEqual([link]);
  });

  it("hyperlink with formatted children preserves nested marks", () => {
    const link: HyperlinkRun = {
      kind: "hyperlink",
      href: "https://example.com",
      children: [
        { kind: "text", text: "Click ", properties: {} },
        { kind: "text", text: "here", properties: { bold: true } },
      ],
    };
    expect(rt([link])).toEqual([link]);
  });

  it("two adjacent hyperlinks with different hrefs stay separate", () => {
    const a: HyperlinkRun = {
      kind: "hyperlink",
      href: "https://a.example",
      children: [{ kind: "text", text: "A", properties: {} }],
    };
    const b: HyperlinkRun = {
      kind: "hyperlink",
      href: "https://b.example",
      children: [{ kind: "text", text: "B", properties: {} }],
    };
    expect(rt([a, b])).toEqual([a, b]);
  });

  it("two adjacent hyperlinks with the SAME href merge", () => {
    // Note: this is a documented behavior of the round-trip. Two
    // sibling hyperlinks with identical hrefs collapse — Y.Text marks
    // can't preserve the boundary.
    const a: HyperlinkRun = {
      kind: "hyperlink",
      href: "https://example.com",
      children: [{ kind: "text", text: "first", properties: {} }],
    };
    const b: HyperlinkRun = {
      kind: "hyperlink",
      href: "https://example.com",
      children: [{ kind: "text", text: "second", properties: {} }],
    };
    const out = rt([a, b]);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({
      kind: "hyperlink",
      href: "https://example.com",
    });
  });

  it("mixed runs: text + tab + text + line break + drawing", () => {
    const runs: InlineRun[] = [
      { kind: "text", text: "Indented:", properties: {} },
      { kind: "tab" },
      { kind: "text", text: "see image", properties: {} },
      { kind: "break", type: "line" },
      {
        kind: "drawing",
        partPath: "word/media/img.png",
        widthEmu: 1000,
        heightEmu: 1000,
        placement: "inline",
      },
    ];
    expect(rt(runs)).toEqual(runs);
  });

  it("complex run properties survive (color, fontSize, shading, etc.)", () => {
    const runs: InlineRun[] = [
      {
        kind: "text",
        text: "rich",
        properties: {
          bold: true,
          italic: true,
          underline: "single",
          color: "#ff0000",
          fontFamily: "Calibri",
          fontSizePt: 14,
          shading: { pattern: "clear", fill: "#fffacd" },
        },
      },
    ];
    expect(rt(runs)).toEqual(runs);
  });
});

describe("runPropsToAttrs / attrsToRunProps", () => {
  it("returns undefined for empty / undefined props", () => {
    expect(runPropsToAttrs(undefined)).toBeUndefined();
    expect(runPropsToAttrs({})).toBeUndefined();
  });

  it("strips unknown 'link' attribute on decode", () => {
    const props = attrsToRunProps({ bold: true, link: { href: "x" } });
    expect(props).toEqual({ bold: true });
  });

  it("encodes and decodes single field", () => {
    const attrs = runPropsToAttrs({ bold: true });
    expect(attrs).toEqual({ bold: true });
    expect(attrsToRunProps(attrs)).toEqual({ bold: true });
  });

  it("round-trips an EXPLICIT toggle-off (Y.Doc parity — a direct caps:false must survive)", () => {
    // A direct `<w:caps w:val="0"/>` that lower-cases a name whose style has
    // caps must survive the seed→project round-trip, or the name renders
    // ALL-CAPS on reload.
    const attrs = runPropsToAttrs({ caps: false });
    expect(attrs).toEqual({ caps: false });
    expect(attrsToRunProps(attrs)).toEqual({ caps: false });
  });
});

describe("deltaToRuns — defensive cases", () => {
  it("handles empty delta", () => {
    expect(deltaToRuns([])).toEqual([]);
  });

  it("ignores a strangely-shaped op with no insert", () => {
    const delta: DeltaOp[] = [
      // @ts-expect-error - deliberately malformed for the test
      { foo: "bar" },
      { insert: "ok" },
    ];
    const out = deltaToRuns(delta);
    expect(out.length).toBe(2);
  });
});

describe("deepEqual", () => {
  it("primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });
  it("objects", () => {
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
  it("nested", () => {
    expect(deepEqual({ a: { b: [1, 2] } }, { a: { b: [1, 2] } })).toBe(true);
    expect(deepEqual({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe(false);
  });
});

describe("runs ↔ delta — structural embed parity", () => {
  it("footnoteRef and commentRef round-trip (were silently DROPPED before)", () => {
    const runs: InlineRun[] = [
      { kind: "text", text: "claim", properties: {} },
      { kind: "footnoteRef", id: 3 },
      { kind: "commentRef", id: 7 },
    ];
    expect(rt(runs)).toEqual(runs);
  });

  it("an UNKNOWN future embed kind survives the round-trip verbatim", () => {
    // The transport must not be a schema gatekeeper: data it doesn't
    // know still belongs to the document.
    const exotic = { kind: "mathZone", omml: "<m:oMath/>" } as unknown as InlineRun;
    expect(rt([exotic])).toEqual([exotic]);
  });

  it("a future field on an existing kind survives without touching runs.ts", () => {
    const run = {
      kind: "drawing",
      partPath: "word/media/i.png",
      widthEmu: 1,
      heightEmu: 1,
      placement: "inline",
      futureCrop: { l: 1, r: 2 },
    } as unknown as InlineRun;
    expect(rt([run])).toEqual([run]);
  });
});
