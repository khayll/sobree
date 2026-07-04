import { describe, expect, it } from "vitest";
import {
  coerceHRelativeFrom,
  coerceVRelativeFrom,
  findAnchorPositionEl,
  readPctPos,
  readPctSize,
  readPosAlign,
  readPosOffset,
} from "./position";
import { el } from "./testUtil";

describe("position — relativeFrom coercion", () => {
  it("keeps recognised horizontal origins, defaults the rest to page", () => {
    expect(coerceHRelativeFrom("margin")).toBe("margin");
    expect(coerceHRelativeFrom("column")).toBe("column");
    expect(coerceHRelativeFrom("page")).toBe("page");
    expect(coerceHRelativeFrom("character")).toBe("page");
    expect(coerceHRelativeFrom(null)).toBe("page");
  });

  it("keeps recognised vertical origins, defaults the rest to page", () => {
    expect(coerceVRelativeFrom("paragraph")).toBe("paragraph");
    expect(coerceVRelativeFrom("margin")).toBe("margin");
    expect(coerceVRelativeFrom("line")).toBe("page");
    expect(coerceVRelativeFrom(null)).toBe("page");
  });

  it("column is horizontal-only, paragraph is vertical-only", () => {
    // `column` isn't a valid vertical origin, `paragraph` isn't horizontal.
    expect(coerceVRelativeFrom("column")).toBe("page");
    expect(coerceHRelativeFrom("paragraph")).toBe("page");
  });
});

describe("position — posOffset", () => {
  it("reads the <wp:posOffset> EMU text", () => {
    const posH = el(
      `<wp:positionH relativeFrom="column"><wp:posOffset>457200</wp:posOffset></wp:positionH>`,
    );
    expect(readPosOffset(posH)).toBe(457200);
  });

  it("returns 0 when the position element or its offset is absent", () => {
    expect(readPosOffset(null)).toBe(0);
    expect(
      readPosOffset(
        el(`<wp:positionH relativeFrom="page"><wp:align>left</wp:align></wp:positionH>`),
      ),
    ).toBe(0);
  });
});

describe("position — align keyword", () => {
  it("reads <wp:align> center", () => {
    const posV = el(`<wp:positionV relativeFrom="page"><wp:align>center</wp:align></wp:positionV>`);
    expect(readPosAlign(posV)).toBe("center");
  });

  it("collapses book-fold inside/outside onto the odd-page side per axis", () => {
    expect(
      readPosAlign(
        el(`<wp:positionH relativeFrom="margin"><wp:align>inside</wp:align></wp:positionH>`),
      ),
    ).toBe("left");
    expect(
      readPosAlign(
        el(`<wp:positionV relativeFrom="margin"><wp:align>outside</wp:align></wp:positionV>`),
      ),
    ).toBe("bottom");
  });

  it("returns undefined for offset-form positions and null elements", () => {
    expect(
      readPosAlign(
        el(`<wp:positionV relativeFrom="page"><wp:posOffset>100</wp:posOffset></wp:positionV>`),
      ),
    ).toBeUndefined();
    expect(readPosAlign(null)).toBeUndefined();
  });
});

describe("position — wp14 percent offset", () => {
  it("normalises 1/1000-percent to a 0-1 fraction", () => {
    const posV = el(
      `<wp:positionV relativeFrom="margin"><wp14:pctPosVOffset>100000</wp14:pctPosVOffset></wp:positionV>`,
    );
    expect(readPctPos(posV)).toBe(1);
    const posH = el(
      `<wp:positionH relativeFrom="page"><wp14:pctPosHOffset>25000</wp14:pctPosHOffset></wp:positionH>`,
    );
    expect(readPctPos(posH)).toBe(0.25);
  });

  it("returns undefined when absent", () => {
    expect(
      readPctPos(el(`<wp:positionV relativeFrom="page"><wp:align>top</wp:align></wp:positionV>`)),
    ).toBeUndefined();
    expect(readPctPos(null)).toBeUndefined();
  });
});

describe("position — mc:AlternateContent-wrapped positions", () => {
  it("finds the Choice-branch positionV (Word's percent-form wrapper)", () => {
    const anchor = el(
      `<wp:anchor behindDoc="0">` +
        `<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>` +
        `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
        `<mc:Choice Requires="wp14"><wp:positionV relativeFrom="margin"><wp14:pctPosVOffset>100000</wp14:pctPosVOffset></wp:positionV></mc:Choice>` +
        `<mc:Fallback><wp:positionV relativeFrom="page"><wp:posOffset>9372600</wp:posOffset></wp:positionV></mc:Fallback>` +
        "</mc:AlternateContent>" +
        "</wp:anchor>",
    );
    const posV = findAnchorPositionEl(anchor, "positionV");
    expect(posV?.getAttribute("relativeFrom")).toBe("margin");
    expect(readPctPos(posV)).toBe(1);
    // The direct positionH still resolves directly.
    expect(readPosAlign(findAnchorPositionEl(anchor, "positionH"))).toBe("center");
  });

  it("uses the Fallback branch when no Choice carries the position", () => {
    const anchor = el(
      `<wp:anchor behindDoc="0">` +
        `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">` +
        `<mc:Fallback><wp:positionV relativeFrom="page"><wp:posOffset>123</wp:posOffset></wp:positionV></mc:Fallback>` +
        "</mc:AlternateContent>" +
        "</wp:anchor>",
    );
    expect(readPosOffset(findAnchorPositionEl(anchor, "positionV"))).toBe(123);
  });
});

describe("position — wp14 percent sizing", () => {
  it("reads pctWidth/pctHeight fractions with their bases", () => {
    const anchor = el(
      `<wp:anchor behindDoc="1">` +
        `<wp14:sizeRelH relativeFrom="margin"><wp14:pctWidth>108500</wp14:pctWidth></wp14:sizeRelH>` +
        `<wp14:sizeRelV relativeFrom="page"><wp14:pctHeight>96400</wp14:pctHeight></wp14:sizeRelV>` +
        "</wp:anchor>",
    );
    expect(readPctSize(anchor)).toEqual({
      pctWidth: 1.085,
      pctWidthFrom: "margin",
      pctHeight: 0.964,
      pctHeightFrom: "page",
    });
  });

  it("a zero percent means not-percent-sized (the extent stays)", () => {
    // A footer bar declares sizeRelV pct=0: its HEIGHT comes from the
    // extent, only the width is margin-relative.
    const anchor = el(
      `<wp:anchor behindDoc="0">` +
        `<wp14:sizeRelH relativeFrom="margin"><wp14:pctWidth>103100</wp14:pctWidth></wp14:sizeRelH>` +
        `<wp14:sizeRelV relativeFrom="margin"><wp14:pctHeight>0</wp14:pctHeight></wp14:sizeRelV>` +
        "</wp:anchor>",
    );
    const out = readPctSize(anchor);
    expect(out.pctWidth).toBeCloseTo(1.031, 5);
    expect(out.pctHeight).toBeUndefined();
  });
});
