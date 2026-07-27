import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../../doc/builders";
import type { Paragraph, SobreeDocument } from "../../doc/types";
import { importDocx } from "../import";
import { exportDocx } from "./index";

/**
 * Round-trip suite for `word/endnotes.xml` — the endnote twin of
 * `notes.test.ts`. Same bar: every test drives `exportDocx` bytes back
 * through `importDocx`, so the emitted XML is proven against our own
 * importer, not just written.
 */

async function roundTrip(doc: SobreeDocument): Promise<SobreeDocument> {
  const out = exportDocx(doc);
  return (await importDocx(out.bytes)).document;
}

function texts(blocks: readonly { kind: string }[] | undefined): string[] {
  return (blocks ?? []).map((b) =>
    b.kind === "paragraph"
      ? (b as Paragraph).runs.map((r) => (r.kind === "text" ? r.text : `[${r.kind}]`)).join("")
      : `[${b.kind}]`,
  );
}

describe("endnote export round-trip", () => {
  it("emits endnotes.xml and the reference mark survives a save → open", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([text("The moon files a report"), { kind: "endnoteRef", id: 1 }, text(".")]),
    ];
    doc.endnotes = { 1: [paragraph([text("Quarterly.")])] };

    const back = await roundTrip(doc);

    expect(texts(back.endnotes?.[1])).toEqual(["Quarterly."]);
    const runs = (back.body[0] as Paragraph).runs;
    expect(runs.some((r) => r.kind === "endnoteRef" && r.id === 1)).toBe(true);
  });

  it("round-trips multi-paragraph bodies and multiple notes, ids kept", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([
        text("a"),
        { kind: "endnoteRef", id: 2 },
        text("b"),
        { kind: "endnoteRef", id: 7 },
      ]),
    ];
    doc.endnotes = {
      2: [paragraph([text("first para")]), paragraph([text("second para")])],
      7: [paragraph([text("note seven")])],
    };

    const back = await roundTrip(doc);

    expect(texts(back.endnotes?.[2])).toEqual(["first para", "second para"]);
    expect(texts(back.endnotes?.[7])).toEqual(["note seven"]);
  });

  it("round-trips a custom reference mark (customMarkFollows)", async () => {
    const doc = emptyDocument();
    doc.body = [paragraph([{ kind: "endnoteRef", id: 1, customMark: "†" }])];
    doc.endnotes = { 1: [paragraph([text("daggered")])] };

    const back = await roundTrip(doc);

    const ref = (back.body[0] as Paragraph).runs.find((r) => r.kind === "endnoteRef");
    expect(ref).toMatchObject({ id: 1, customMark: "†" });
  });

  it("footnotes and endnotes coexist in one package without id collisions", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([text("both"), { kind: "footnoteRef", id: 1 }, { kind: "endnoteRef", id: 1 }]),
    ];
    doc.footnotes = { 1: [paragraph([text("foot body")])] };
    doc.endnotes = { 1: [paragraph([text("end body")])] };

    const back = await roundTrip(doc);

    expect(texts(back.footnotes?.[1])).toEqual(["foot body"]);
    expect(texts(back.endnotes?.[1])).toEqual(["end body"]);
  });

  it("emits no endnotes part for a document without endnotes", () => {
    const doc = emptyDocument();
    doc.body = [paragraph([text("plain")])];
    const out = exportDocx(doc);
    const xml = new TextDecoder().decode(out.bytes);
    expect(xml.includes("endnotes.xml")).toBe(false);
  });
});
