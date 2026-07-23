import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../../doc/builders";
import { table, tableCell, tableRow } from "../../doc/builders";
import type { Paragraph, SobreeDocument } from "../../doc/types";
import { importDocx } from "../import";
import { exportDocx } from "./index";

/**
 * Round-trip suite for `word/footnotes.xml` / `word/comments.xml` /
 * `word/commentsExtended.xml` emission. Every test drives the REAL cycle
 * — `exportDocx` bytes re-parsed by `importDocx` — so it proves the
 * emitted XML is what our own importer (and by extension Word's shapes
 * it mirrors) understands, not just that some XML got written.
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

describe("footnote export round-trip", () => {
  it("emits footnotes.xml and the reference mark survives a save → open", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([text("The sky keeps a diary"), { kind: "footnoteRef", id: 1 }, text(".")]),
    ];
    doc.footnotes = { 1: [paragraph([text("An honest one.")])] };

    const back = await roundTrip(doc);

    expect(texts(back.footnotes?.[1])).toEqual(["An honest one."]);
    const runs = (back.body[0] as Paragraph).runs;
    expect(runs.some((r) => r.kind === "footnoteRef" && r.id === 1)).toBe(true);
  });

  it("round-trips multi-paragraph bodies and multiple notes, ids kept", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([
        text("a"),
        { kind: "footnoteRef", id: 2 },
        text("b"),
        { kind: "footnoteRef", id: 5 },
      ]),
    ];
    doc.footnotes = {
      2: [paragraph([text("first para")]), paragraph([text("second para")])],
      5: [paragraph([text("note five")])],
    };

    const back = await roundTrip(doc);

    expect(texts(back.footnotes?.[2])).toEqual(["first para", "second para"]);
    expect(texts(back.footnotes?.[5])).toEqual(["note five"]);
  });

  it("round-trips a custom reference mark (customMarkFollows)", async () => {
    const doc = emptyDocument();
    doc.body = [paragraph([{ kind: "footnoteRef", id: 1, customMark: "*" }])];
    doc.footnotes = { 1: [paragraph([text("starred")])] };

    const back = await roundTrip(doc);

    const ref = (back.body[0] as Paragraph).runs.find((r) => r.kind === "footnoteRef");
    expect(ref).toMatchObject({ id: 1, customMark: "*" });
  });

  it("emits no footnotes part for a document without footnotes", () => {
    const doc = emptyDocument();
    doc.body = [paragraph([text("plain")])];
    const out = exportDocx(doc);
    const xml = new TextDecoder().decode(out.bytes);
    // Cheap containment check on the zip bytes: the part path string only
    // appears if the part (and its content-type override) were staged.
    expect(xml.includes("word/footnotes.xml")).toBe(false);
  });
});

describe("comment export round-trip", () => {
  function commented(): SobreeDocument {
    const doc = emptyDocument();
    doc.body = [
      paragraph([
        text("before "),
        text("annotated", { commentIds: [0] }),
        { kind: "commentRef", id: 0 },
        text(" after"),
      ]),
    ];
    doc.comments = {
      0: {
        id: 0,
        author: "Ada",
        initials: "A",
        date: "2026-07-22T10:00:00Z",
        body: [paragraph([text("Looks wrong.")])],
      },
    };
    return doc;
  }

  it("round-trips the comment body, author metadata and the tagged range", async () => {
    const back = await roundTrip(commented());

    expect(back.comments?.[0]).toMatchObject({
      id: 0,
      author: "Ada",
      initials: "A",
      date: "2026-07-22T10:00:00Z",
    });
    expect(texts(back.comments?.[0]?.body)).toEqual(["Looks wrong."]);

    const runs = (back.body[0] as Paragraph).runs;
    const tagged = runs.find((r) => r.kind === "text" && r.text === "annotated");
    expect(tagged).toMatchObject({ properties: { commentIds: [0] } });
    const untagged = runs.find((r) => r.kind === "text" && r.text === "before ");
    expect(
      (untagged as { properties?: { commentIds?: unknown } }).properties?.commentIds,
    ).toBeUndefined();
    expect(runs.some((r) => r.kind === "commentRef" && r.id === 0)).toBe(true);
  });

  it("round-trips threading: done + replyToId via commentsExtended.xml", async () => {
    const doc = commented();
    doc.comments = {
      ...doc.comments,
      0: { ...doc.comments![0]!, done: true },
      3: {
        id: 3,
        author: "Bob",
        body: [paragraph([text("Agreed — fixed.")])],
        replyToId: 0,
      },
    };

    const back = await roundTrip(doc);

    expect(back.comments?.[0]?.done).toBe(true);
    expect(back.comments?.[3]).toMatchObject({ author: "Bob", replyToId: 0 });
    expect(texts(back.comments?.[3]?.body)).toEqual(["Agreed — fixed."]);
  });

  it("threads replies even when the parent's body first paragraph is EMPTY", async () => {
    // An empty paragraph serializes self-closed (`<w:p/>`); the paraId
    // stamp must land on that shape too or the reply join silently breaks.
    const doc = emptyDocument();
    doc.body = [paragraph([text("x", { commentIds: [7] }), { kind: "commentRef", id: 7 }])];
    doc.comments = {
      7: { id: 7, body: [paragraph([])], done: true },
      8: { id: 8, body: [paragraph([text("re")])], replyToId: 7 },
    };

    const back = await roundTrip(doc);

    expect(back.comments?.[7]?.done).toBe(true);
    expect(back.comments?.[8]?.replyToId).toBe(7);
  });

  it("reconstructs a range spanning multiple paragraphs", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([text("tail of one", { commentIds: [1] })]),
      paragraph([text("all of two", { commentIds: [1] })]),
      paragraph([text("head", { commentIds: [1] }), { kind: "commentRef", id: 1 }, text(" rest")]),
    ];
    doc.comments = { 1: { id: 1, body: [paragraph([text("spans")])] } };

    const back = await roundTrip(doc);

    // Every tagged run stays tagged; the untagged tail stays clean.
    expect((back.body[0] as Paragraph).runs[0]).toMatchObject({
      properties: { commentIds: [1] },
    });
    expect((back.body[1] as Paragraph).runs[0]).toMatchObject({
      properties: { commentIds: [1] },
    });
    const last = back.body[2] as Paragraph;
    expect(last.runs.find((r) => r.kind === "text" && r.text === "head")).toMatchObject({
      properties: { commentIds: [1] },
    });
    const rest = last.runs.find((r) => r.kind === "text" && r.text === " rest");
    expect(
      (rest as { properties?: { commentIds?: unknown } }).properties?.commentIds,
    ).toBeUndefined();
  });

  it("a range dangling at the end of the body still closes (importer sees balanced marks)", async () => {
    const doc = emptyDocument();
    doc.body = [paragraph([text("open to the end", { commentIds: [2] })])];
    doc.comments = { 2: { id: 2, body: [paragraph([text("dangler")])] } };

    const back = await roundTrip(doc);

    expect((back.body[0] as Paragraph).runs[0]).toMatchObject({
      properties: { commentIds: [2] },
    });
    // The re-import must not leak the range into… anything; there is
    // nothing after, so surviving the cycle at all proves the emitted
    // package was well-formed for the importer.
    expect(texts(back.comments?.[2]?.body)).toEqual(["dangler"]);
  });

  it("a body-level range does not leak end markers into a table it spans", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([text("before", { commentIds: [4] })]),
      table([tableRow([tableCell([paragraph([text("cell")])])])]),
      paragraph([text("after", { commentIds: [4] }), { kind: "commentRef", id: 4 }]),
    ];
    doc.comments = { 4: { id: 4, body: [paragraph([text("across")])] } };

    const back = await roundTrip(doc);

    // The cell's run must NOT come back tagged — the range is body-level.
    const cellPara = (back.body[1] as { rows: { cells: { content: Paragraph[] }[] }[] }).rows[0]!
      .cells[0]!.content[0]!;
    expect(
      (cellPara.runs[0] as { properties?: { commentIds?: unknown } }).properties?.commentIds,
    ).toBeUndefined();
    // …while both body paragraphs stay tagged.
    expect((back.body[0] as Paragraph).runs[0]).toMatchObject({
      properties: { commentIds: [4] },
    });
    expect((back.body[2] as Paragraph).runs[0]).toMatchObject({
      properties: { commentIds: [4] },
    });
  });
});
