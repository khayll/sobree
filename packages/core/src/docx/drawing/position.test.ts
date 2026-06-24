import { describe, expect, it } from "vitest";
import { coerceHRelativeFrom, coerceVRelativeFrom, readPosOffset } from "./position";
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
