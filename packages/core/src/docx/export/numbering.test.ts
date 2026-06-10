import { describe, expect, it } from "vitest";
import { renderNumberingXml } from "./numbering";
import { parseNumberingXml } from "../import/numbering";
import type { NumberingDefinition } from "../../doc/types";

describe("renderNumberingXml", () => {
  it("returns null for no definitions (part omitted from the package)", () => {
    expect(renderNumberingXml([])).toBeNull();
  });

  it("round-trips through the import parser losslessly", () => {
    const defs: NumberingDefinition[] = [
      {
        numId: 2,
        abstractFormat: {
          levels: [
            {
              level: 0,
              format: "bullet",
              text: "•",
              paragraphIndent: { leftTwips: 216, hangingTwips: 216 },
              runDefaults: { color: "#7F8685", fontFamily: "Arial Unicode MS", fontSizePt: 10 },
            },
            { level: 1, format: "bullet", text: "◦", restart: 1 },
          ],
        },
      },
      {
        numId: 5,
        abstractFormat: {
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              paragraphIndent: { leftTwips: 720, hangingTwips: 360 },
            },
          ],
        },
      },
    ];
    const xml = renderNumberingXml(defs);
    expect(xml).not.toBeNull();
    expect(parseNumberingXml(xml!)).toEqual(defs);
  });
});
