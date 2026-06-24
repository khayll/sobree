import { describe, expect, it } from "vitest";
import { el } from "./testUtil";
import { readWrapText, readWrapType } from "./wrap";

describe("wrap — wrap mode", () => {
  it("maps each <wp:wrap*> child to its enum", () => {
    expect(readWrapType(el(`<wp:anchor><wp:wrapSquare wrapText="bothSides"/></wp:anchor>`))).toBe(
      "square",
    );
    expect(readWrapType(el("<wp:anchor><wp:wrapTopAndBottom/></wp:anchor>"))).toBe("topAndBottom");
    expect(readWrapType(el("<wp:anchor><wp:wrapTight/></wp:anchor>"))).toBe("tight");
    expect(readWrapType(el("<wp:anchor><wp:wrapThrough/></wp:anchor>"))).toBe("through");
    expect(readWrapType(el("<wp:anchor><wp:wrapNone/></wp:anchor>"))).toBe("none");
  });

  it("returns undefined when no wrap child is present", () => {
    expect(readWrapType(el(`<wp:anchor><wp:extent cx="1" cy="1"/></wp:anchor>`))).toBeUndefined();
  });
});

describe("wrap — wrapText side", () => {
  it("reads wrapText off a displacing wrap child", () => {
    expect(readWrapText(el(`<wp:anchor><wp:wrapSquare wrapText="left"/></wp:anchor>`))).toBe(
      "left",
    );
    expect(readWrapText(el(`<wp:anchor><wp:wrapTight wrapText="right"/></wp:anchor>`))).toBe(
      "right",
    );
    expect(readWrapText(el(`<wp:anchor><wp:wrapThrough wrapText="largest"/></wp:anchor>`))).toBe(
      "largest",
    );
  });

  it("ignores wrapText on non-displacing wraps and unknown values", () => {
    // topAndBottom / none don't carry wrapText.
    expect(
      readWrapText(el(`<wp:anchor><wp:wrapTopAndBottom wrapText="left"/></wp:anchor>`)),
    ).toBeUndefined();
    expect(
      readWrapText(el(`<wp:anchor><wp:wrapSquare wrapText="sideways"/></wp:anchor>`)),
    ).toBeUndefined();
    expect(readWrapText(el("<wp:anchor><wp:wrapSquare/></wp:anchor>"))).toBeUndefined();
  });
});
