import {
  appendBlock,
  emptyDocument,
  heading,
  paragraph,
  strong,
  text,
} from "../doc/builders";
import type { Paragraph, SobreeDocument } from "../doc/types";
import { exportDocx } from "./export/index";
import { importDocx } from "./import/index";
import { describe, expect, it } from "vitest";

async function roundTrip(doc: SobreeDocument): Promise<SobreeDocument> {
  const { bytes } = exportDocx(doc);
  const { document } = await importDocx(bytes);
  return document;
}

function buildSample(): SobreeDocument {
  const doc = emptyDocument();
  doc.body = [];
  appendBlock(doc, heading(1, [text("Chapter")]));
  appendBlock(doc, paragraph([text("Hello "), strong("world"), text(".")]));
  appendBlock(
    doc,
    paragraph([text("Colourful", { color: "#ff0000", bold: true })]),
  );
  return doc;
}

describe("AST-native DOCX round-trip (Phase N2)", () => {
  it("round-trips a simple document entirely through the AST", async () => {
    const result = await roundTrip(buildSample());
    expect(result.body.length).toBeGreaterThan(0);
    const heading1 = result.body.find(
      (b): b is Paragraph => b.kind === "paragraph" && b.properties.styleId === "Heading1",
    );
    expect(heading1).toBeDefined();
    expect(heading1?.runs[0]).toMatchObject({ kind: "text", text: "Chapter" });
  });

  it("preserves bold + italic run properties through OOXML", async () => {
    const doc = emptyDocument();
    doc.body = [paragraph([text("bold+italic", { bold: true, italic: true })])];
    const result = await roundTrip(doc);
    const run = (result.body[0] as Paragraph).runs[0];
    if (run?.kind !== "text") throw new Error("expected text run");
    expect(run.properties.bold).toBe(true);
    expect(run.properties.italic).toBe(true);
  });

  it("preserves strikethrough and underline", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([
        text("struck", { strike: true }),
        text(" "),
        text("underlined", { underline: "single" }),
      ]),
    ];
    const result = await roundTrip(doc);
    const runs = (result.body[0] as Paragraph).runs;
    expect(runs.find((r) => r.kind === "text" && r.text === "struck")?.kind).toBe("text");
    expect(
      runs.find((r) => r.kind === "text" && r.text === "underlined" && r.properties.underline) !==
        undefined,
    ).toBe(true);
  });

  it("preserves color and font family/size", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([
        text("styled", {
          color: "#3366cc",
          fontFamily: "Georgia",
          fontSizePt: 14,
        }),
      ]),
    ];
    const result = await roundTrip(doc);
    const run = (result.body[0] as Paragraph).runs[0];
    if (run?.kind !== "text") throw new Error("expected text run");
    expect(run.properties.color?.toLowerCase()).toBe("#3366cc");
    expect(run.properties.fontFamily).toBe("Georgia");
    expect(run.properties.fontSizePt).toBe(14);
  });

  it("preserves paragraph alignment", async () => {
    const doc = emptyDocument();
    const p = paragraph([text("centred")]);
    p.properties.alignment = "center";
    doc.body = [p];
    const result = await roundTrip(doc);
    expect((result.body[0] as Paragraph).properties.alignment).toBe("center");
  });

  it("preserves page size and orientation", async () => {
    const doc = emptyDocument();
    doc.sections[0]!.pageSize = { wTwips: 16839, hTwips: 11907, orientation: "landscape" };
    const result = await roundTrip(doc);
    const section = result.sections[0];
    expect(section?.pageSize.orientation).toBe("landscape");
  });

  describe("tracked changes — inline revisions", () => {
    it("preserves an inline ins revision through round-trip", async () => {
      const doc = emptyDocument();
      doc.body = [
        paragraph([
          text("Keep "),
          text("inserted", { revision: { type: "ins", author: "Alice" } }),
          text(" end"),
        ]),
      ];
      const result = await roundTrip(doc);
      const runs = (result.body[0] as Paragraph).runs;
      const ins = runs.find(
        (r) => r.kind === "text" && r.text === "inserted",
      );
      expect(ins?.kind === "text" ? ins.properties.revision?.type : null).toBe("ins");
      expect(ins?.kind === "text" ? ins.properties.revision?.author : null).toBe("Alice");
    });

    it("preserves an inline del revision through round-trip", async () => {
      const doc = emptyDocument();
      doc.body = [
        paragraph([
          text("Keep "),
          text("deleted", { revision: { type: "del", author: "Alice" } }),
          text(" end"),
        ]),
      ];
      const result = await roundTrip(doc);
      const runs = (result.body[0] as Paragraph).runs;
      const del = runs.find((r) => r.kind === "text" && r.text === "deleted");
      expect(del?.kind === "text" ? del.properties.revision?.type : null).toBe("del");
      expect(del?.kind === "text" ? del.properties.revision?.author : null).toBe("Alice");
    });

    it("preserves a paragraph-mark ins revision through round-trip", async () => {
      const doc = emptyDocument();
      doc.body = [
        paragraph([text("First")]),
        paragraph([text("Second")], { revision: { type: "ins", author: "Alice" } }),
      ];
      const result = await roundTrip(doc);
      expect(result.body).toHaveLength(2);
      const second = result.body[1] as Paragraph;
      expect(second.properties.revision?.type).toBe("ins");
      expect(second.properties.revision?.author).toBe("Alice");
    });

    it("preserves a paragraph-mark del revision through round-trip", async () => {
      const doc = emptyDocument();
      doc.body = [
        paragraph([text("First")]),
        paragraph([text("Second")], { revision: { type: "del", author: "Alice" } }),
      ];
      const result = await roundTrip(doc);
      expect(result.body).toHaveLength(2);
      const second = result.body[1] as Paragraph;
      expect(second.properties.revision?.type).toBe("del");
      expect(second.properties.revision?.author).toBe("Alice");
    });

    it("preserves a format-change revision (w:rPrChange) through round-trip", async () => {
      const doc = emptyDocument();
      doc.body = [
        paragraph([
          text("plain "),
          text("bolded", {
            bold: true,
            revisionFormat: {
              before: {}, // pre-tracked: no bold
              author: "Alice",
            },
          }),
        ]),
      ];
      const result = await roundTrip(doc);
      const runs = (result.body[0] as Paragraph).runs;
      const bolded = runs.find((r) => r.kind === "text" && r.text === "bolded");
      expect(bolded?.kind === "text" ? bolded.properties.bold : null).toBe(true);
      expect(
        bolded?.kind === "text" ? bolded.properties.revisionFormat?.author : null,
      ).toBe("Alice");
      expect(
        bolded?.kind === "text" ? bolded.properties.revisionFormat?.before.bold : null,
      ).toBeUndefined();
    });

    it("rPrChange snapshot preserves bold + italic + color", async () => {
      const doc = emptyDocument();
      doc.body = [
        paragraph([
          text("changed", {
            bold: true,
            italic: true,
            revisionFormat: {
              before: { color: "#ff0000" }, // was red, now bold+italic with no color
              author: "Bob",
              date: "2026-05-24T00:00:00Z",
            },
          }),
        ]),
      ];
      const result = await roundTrip(doc);
      const run = (result.body[0] as Paragraph).runs[0];
      if (run?.kind !== "text") throw new Error("expected text run");
      expect(run.properties.bold).toBe(true);
      expect(run.properties.italic).toBe(true);
      expect(run.properties.revisionFormat?.author).toBe("Bob");
      expect(run.properties.revisionFormat?.before.color).toBe("#ff0000");
    });

    it("preserves an adjacent del+ins replacement by the same author", async () => {
      const doc = emptyDocument();
      doc.body = [
        paragraph([
          text("Term is "),
          text("twelve", { revision: { type: "del", author: "Alice" } }),
          text("twenty-four", { revision: { type: "ins", author: "Alice" } }),
          text(" months."),
        ]),
      ];
      const result = await roundTrip(doc);
      const runs = (result.body[0] as Paragraph).runs;
      const del = runs.find((r) => r.kind === "text" && r.text === "twelve");
      const ins = runs.find((r) => r.kind === "text" && r.text === "twenty-four");
      expect(del?.kind === "text" ? del.properties.revision?.type : null).toBe("del");
      expect(ins?.kind === "text" ? ins.properties.revision?.type : null).toBe("ins");
    });
  });
});
