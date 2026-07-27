import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../../doc/builders";
import type { Paragraph, SobreeDocument } from "../../doc/types";
import { importDocx } from "../import";
import { exportDocx } from "./index";

/**
 * Bookmark markers (`w:bookmarkStart/End`) — Tier 2b's foundation: REF /
 * PAGEREF / TOC all resolve through bookmark names. Zero-length marker
 * runs at exact offsets, round-tripped through real exportDocx →
 * importDocx bytes.
 */

async function roundTrip(doc: SobreeDocument): Promise<SobreeDocument> {
  return (await importDocx(exportDocx(doc).bytes)).document;
}

describe("bookmark marker round-trip", () => {
  it("a TOC-style point bookmark at a heading start survives at its offset", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph(
        [
          { kind: "bookmarkStart", id: 3, name: "_Toc123456789" },
          { kind: "bookmarkEnd", id: 3 },
          text("Chapter One"),
        ],
        { styleId: "Heading1" },
      ),
    ];

    const back = await roundTrip(doc);

    const runs = (back.body[0] as Paragraph).runs;
    expect(runs[0]).toEqual({ kind: "bookmarkStart", id: 3, name: "_Toc123456789" });
    expect(runs[1]).toEqual({ kind: "bookmarkEnd", id: 3 });
    expect(runs[2]).toMatchObject({ kind: "text", text: "Chapter One" });
  });

  it("a range bookmark spanning paragraphs keeps both markers in place", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([
        text("start "),
        { kind: "bookmarkStart", id: 7, name: "Section_A" },
        text("here"),
      ]),
      paragraph([text("continues")]),
      paragraph([text("ends"), { kind: "bookmarkEnd", id: 7 }, text(" after")]),
    ];

    const back = await roundTrip(doc);

    const first = (back.body[0] as Paragraph).runs;
    expect(first[1]).toEqual({ kind: "bookmarkStart", id: 7, name: "Section_A" });
    const last = (back.body[2] as Paragraph).runs;
    expect(last.findIndex((r) => r.kind === "bookmarkEnd")).toBe(1);
  });

  it("bookmark names with XML-hostile characters survive escaping", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([
        { kind: "bookmarkStart", id: 1, name: 'A&B<"quoted">' },
        { kind: "bookmarkEnd", id: 1 },
      ]),
    ];

    const back = await roundTrip(doc);

    expect((back.body[0] as Paragraph).runs[0]).toMatchObject({ name: 'A&B<"quoted">' });
  });

  it("markers contribute zero to offsets — text before/after keeps its length", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([
        text("ab"),
        { kind: "bookmarkStart", id: 2, name: "mid" },
        { kind: "bookmarkEnd", id: 2 },
        text("cd"),
      ]),
    ];

    const back = await roundTrip(doc);

    const p = back.body[0] as Paragraph;
    const flat = p.runs.map((r) => (r.kind === "text" ? r.text : "")).join("");
    expect(flat).toBe("abcd");
    // Marker order preserved between the two text runs.
    expect(p.runs.map((r) => r.kind)).toEqual(["text", "bookmarkStart", "bookmarkEnd", "text"]);
  });
});
