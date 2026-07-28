import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../../doc/builders";
import type { Paragraph, SobreeDocument } from "../../doc/types";
import { importDocx } from "../import";
import { exportDocx } from "./index";

/** Round-trip for the `renderPPr` fields recorded as plan item 2e:
 *  `tabStops` (`<w:tabs>`) and `runDefaults` (paragraph-mark `<w:rPr>`). */

async function roundTrip(doc: SobreeDocument): Promise<SobreeDocument> {
  return (await importDocx(exportDocx(doc).bytes)).document;
}

describe("pPr fidelity round-trip", () => {
  it("custom tab stops survive with alignment, leader and position", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([text("label\tvalue")], {
        tabStops: [
          { positionTwips: 720, alignment: "left" },
          { positionTwips: 4320, alignment: "right", leader: "dot" },
          { positionTwips: 7200, alignment: "center" },
        ],
      }),
    ];

    const back = await roundTrip(doc);

    expect((back.body[0] as Paragraph).properties.tabStops).toEqual([
      { positionTwips: 720, alignment: "left" },
      { positionTwips: 4320, alignment: "right", leader: "dot" },
      { positionTwips: 7200, alignment: "center" },
    ]);
  });

  it("paragraph-mark run defaults (font + size) survive", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([], { runDefaults: { fontFamily: "Helvetica", fontSizePt: 9 } }),
      paragraph([text("sized mark")], { runDefaults: { fontSizePt: 14 } }),
    ];

    const back = await roundTrip(doc);

    expect((back.body[0] as Paragraph).properties.runDefaults).toEqual({
      fontFamily: "Helvetica",
      fontSizePt: 9,
    });
    expect((back.body[1] as Paragraph).properties.runDefaults).toEqual({ fontSizePt: 14 });
  });
});
