import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../doc/builders";
import { pageSetupToSection, sectionToPageSetup } from "../doc/pageSetupBridge";
import { DEFAULT_PAGE_SETUP, type PageSetup } from "../paperStack/pageSetup";
import { exportDocx } from "./export/index";
import { importDocx } from "./import/index";

async function roundTripSetup(setup: PageSetup) {
  const doc = emptyDocument();
  doc.body = [paragraph([text("hi")])];
  const { section, headerFooterBodies } = pageSetupToSection(setup);
  doc.sections = [section];
  doc.headerFooterBodies = headerFooterBodies;
  const { bytes } = exportDocx(doc);
  const { document: imported } = await importDocx(bytes);
  const importedSection = imported.sections[0];
  if (!importedSection) throw new Error("imported doc missing section");
  return { pageSetup: sectionToPageSetup(importedSection, imported.headerFooterBodies) };
}

function setupWith(patch: Partial<PageSetup>): PageSetup {
  return { ...structuredClone(DEFAULT_PAGE_SETUP), ...patch };
}

describe("DOCX page setup round-trip", () => {
  it("preserves paper size and orientation", async () => {
    for (const size of ["A4", "Letter", "Legal", "A3"] as const) {
      for (const orientation of ["portrait", "landscape"] as const) {
        const { pageSetup } = await roundTripSetup(setupWith({ size, orientation }));
        expect(pageSetup.size).toBe(size);
        expect(pageSetup.orientation).toBe(orientation);
      }
    }
  });

  it("preserves margins (within 1mm rounding)", async () => {
    const margins = { top: 30, right: 22, bottom: 28, left: 18 };
    const { pageSetup } = await roundTripSetup(setupWith({ margins }));
    expect(pageSetup.margins).toBeDefined();
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const got = pageSetup.margins?.[side] ?? -1;
      expect(Math.abs(got - margins[side])).toBeLessThanOrEqual(1);
    }
  });
});

describe("DOCX header / footer round-trip", () => {
  it("round-trips a plain footer template", async () => {
    const { pageSetup } = await roundTripSetup(
      setupWith({
        footer: {
          default: "Confidential",
          first: "",
          last: "",
          differentFirst: false,
          differentLast: false,
        },
      }),
    );
    expect(pageSetup.footer?.default).toBe("Confidential");
  });

  it("round-trips {page} and {pages} field codes in the footer", async () => {
    const { pageSetup } = await roundTripSetup(
      setupWith({
        footer: {
          default: "Page {page} of {pages}",
          first: "",
          last: "",
          differentFirst: false,
          differentLast: false,
        },
      }),
    );
    expect(pageSetup.footer?.default).toBe("Page {page} of {pages}");
  });

  it("round-trips header + differentFirst slot", async () => {
    const { pageSetup } = await roundTripSetup(
      setupWith({
        header: {
          default: "Regular header",
          first: "Title page",
          last: "",
          differentFirst: true,
          differentLast: false,
        },
      }),
    );
    expect(pageSetup.header?.default).toBe("Regular header");
    expect(pageSetup.header?.first).toBe("Title page");
    expect(pageSetup.header?.differentFirst).toBe(true);
  });

  it("leaves header/footer undefined when nothing was set", async () => {
    const { pageSetup } = await roundTripSetup(
      setupWith({
        header: { default: "", first: "", last: "", differentFirst: false, differentLast: false },
        footer: { default: "", first: "", last: "", differentFirst: false, differentLast: false },
      }),
    );
    expect(pageSetup.header).toBeUndefined();
    expect(pageSetup.footer).toBeUndefined();
  });
});

describe("DOCX multi-section round-trip", () => {
  it("round-trips a centred title-page section followed by a body section", async () => {
    // Two-section document mirroring the demo's title-page shape:
    //  section 0 → vAlign center, titlePg, header1.xml + footer1.xml
    //  SectionBreak block delimits them.
    //  section 1 → default vAlign, header1.xml + footer1.xml
    const doc = emptyDocument();
    doc.body = [
      paragraph([text("The Hydrospanner Field Manual")]),
      { kind: "section_break", toSectionIndex: 1 },
      paragraph([text("Chapter 1: Calibration")]),
      paragraph([text("Body text here.")]),
    ];
    doc.headerFooterBodies = {
      "header1.xml": [paragraph([text("Manual title")])],
      "footer1.xml": [paragraph([text("Page ")])],
    };
    doc.sections = [
      {
        pageSize: { wTwips: 11906, hTwips: 16838, orientation: "portrait" },
        pageMargins: {
          topTwips: 1440,
          rightTwips: 1440,
          bottomTwips: 1440,
          leftTwips: 1440,
          headerTwips: 720,
          footerTwips: 720,
          gutterTwips: 0,
        },
        headerRefs: [{ type: "default", partId: "header1.xml" }],
        footerRefs: [{ type: "default", partId: "footer1.xml" }],
        vAlign: "center",
        titlePage: true,
        type: "nextPage",
      },
      {
        pageSize: { wTwips: 11906, hTwips: 16838, orientation: "portrait" },
        pageMargins: {
          topTwips: 1440,
          rightTwips: 1440,
          bottomTwips: 1440,
          leftTwips: 1440,
          headerTwips: 720,
          footerTwips: 720,
          gutterTwips: 0,
        },
        headerRefs: [{ type: "default", partId: "header1.xml" }],
        footerRefs: [{ type: "default", partId: "footer1.xml" }],
      },
    ];

    const { bytes } = exportDocx(doc);
    const { document: imported } = await importDocx(bytes);

    // Two sections survive the round trip.
    expect(imported.sections.length).toBe(2);
    // Section-0 properties preserved.
    expect(imported.sections[0]?.vAlign).toBe("center");
    expect(imported.sections[0]?.titlePage).toBe(true);
    expect(imported.sections[0]?.type).toBe("nextPage");
    // Section-1 has default vAlign (omitted on export, comes back as undefined).
    expect(imported.sections[1]?.vAlign).toBeUndefined();
    // SectionBreak block present in the body, between title and chapter.
    const breakIdx = imported.body.findIndex((b) => b.kind === "section_break");
    expect(breakIdx).toBeGreaterThan(0);
    expect(breakIdx).toBeLessThan(imported.body.length - 1);
    // Header/footer parts loaded.
    expect(imported.headerFooterBodies["header1.xml"]).toBeDefined();
    expect(imported.headerFooterBodies["footer1.xml"]).toBeDefined();
  });
});
