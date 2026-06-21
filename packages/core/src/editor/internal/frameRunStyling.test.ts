import { describe, expect, it } from "vitest";
import type { Block } from "../../doc/types";
import { inheritBareRunStyling } from "./frameRunStyling";

const styled = { color: "#0555A5", fontFamily: "Myriad Pro Cond", fontSizePt: 48, bold: true };

function para(...runs: { text: string; properties?: object }[]): Block {
  return {
    kind: "paragraph",
    runs: runs.map((r) => ({ kind: "text", text: r.text, properties: r.properties ?? {} })),
    properties: {},
  };
}

const propsOf = (b: Block, i: number) =>
  ((b as { runs: { properties: object }[] }).runs[i]?.properties ?? {}) as Record<string, unknown>;

describe("inheritBareRunStyling", () => {
  it("gives a bare run the previous styled run's properties", () => {
    const [out] = inheritBareRunStyling([para({ text: "Big", properties: styled }, { text: "z" })]);
    expect(propsOf(out!, 1)).toEqual(styled); // the bare "z" run
  });

  it("falls back to the NEXT styled run when there's no previous one", () => {
    // A char typed at the very start lands before the styled span.
    const [out] = inheritBareRunStyling([para({ text: "z" }, { text: "Big", properties: styled })]);
    expect(propsOf(out!, 0)).toEqual(styled);
  });

  it("leaves already-styled runs untouched", () => {
    const own = { fontSizePt: 12 };
    const [out] = inheritBareRunStyling([
      para({ text: "a", properties: styled }, { text: "b", properties: own }),
    ]);
    expect(propsOf(out!, 1)).toEqual(own);
  });

  it("is a no-op when there is no styled neighbour to inherit from", () => {
    const input = [para({ text: "a" }, { text: "b" })];
    expect(inheritBareRunStyling(input)).toEqual(input);
  });

  it("ignores non-paragraph blocks", () => {
    const table: Block = { kind: "table", rows: [], grid: [] } as unknown as Block;
    expect(inheritBareRunStyling([table])).toEqual([table]);
  });
});
