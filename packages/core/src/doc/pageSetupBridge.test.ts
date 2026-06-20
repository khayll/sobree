import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SETUP } from "../paperStack/pageSetup";
import { pageSetupToSection, sectionToPageSetup } from "./pageSetupBridge";
import type { SectionProperties } from "./types";

function section(marginTwips: number): SectionProperties {
  return {
    pageSize: { wTwips: 12240, hTwips: 15840, orientation: "portrait" }, // US Letter
    pageMargins: {
      topTwips: marginTwips,
      rightTwips: marginTwips,
      bottomTwips: marginTwips,
      leftTwips: marginTwips,
      headerTwips: 720,
      footerTwips: 720,
      gutterTwips: 0,
    },
    headerRefs: [],
    footerRefs: [],
  };
}

describe("sectionToPageSetup margins", () => {
  it("preserves sub-millimetre precision (720 twips = 12.7mm, not 13mm)", () => {
    // Rounding 720 twips to a whole 13mm shifted every margin-anchored
    // frame ~0.3mm right — visible as uneven left/right page margins.
    const setup = sectionToPageSetup(section(720), {});
    expect(setup.margins).toEqual({ top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 });
  });

  it("round-trips twip margins losslessly through mm", () => {
    for (const twips of [720, 1080, 1440, 1134, 851]) {
      const setup = sectionToPageSetup(section(twips), {});
      const back = pageSetupToSection({ ...DEFAULT_PAGE_SETUP, margins: setup.margins! });
      expect(back.section.pageMargins.leftTwips).toBe(twips);
    }
  });
});
