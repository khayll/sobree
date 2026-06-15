import { describe, expect, it } from "vitest";
import { parseCommentsXml } from "./comments";
import { convertDocumentXml } from "./document";
import { readParagraph } from "./paragraphs";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const ctx = { rels: new Map<string, string>() };

describe("parseCommentsXml", () => {
  it("returns {} for missing xml", () => {
    expect(parseCommentsXml(undefined, ctx)).toEqual({});
  });

  it("parses comments with id, author, initials, date, body", () => {
    const xml = `<?xml version="1.0"?><w:comments xmlns:w="${NS_W}">
      <w:comment w:id="0" w:author="Alice" w:initials="A" w:date="2026-05-21T10:00:00Z">
        <w:p><w:r><w:t>Looks good!</w:t></w:r></w:p>
      </w:comment>
      <w:comment w:id="1" w:author="Bob">
        <w:p><w:r><w:t>Please clarify.</w:t></w:r></w:p>
      </w:comment>
    </w:comments>`;
    const out = parseCommentsXml(xml, ctx);
    expect(Object.keys(out).sort()).toEqual(["0", "1"]);
    expect(out[0]).toMatchObject({
      id: 0,
      author: "Alice",
      initials: "A",
      date: "2026-05-21T10:00:00Z",
    });
    expect(out[0]?.body).toHaveLength(1);
    expect(out[1]?.author).toBe("Bob");
    expect(out[1]?.initials).toBeUndefined();
  });
});

describe("parseCommentsXml — extensions (resolved status)", () => {
  it("marks comment as done when commentsExtended says so", () => {
    const NS_W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
    const NS_W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
    const commentsXml = `<?xml version="1.0"?><w:comments xmlns:w="${NS_W}" xmlns:w14="${NS_W14}">
      <w:comment w:id="0" w:author="Alice">
        <w:p w14:paraId="AABB1122"><w:r><w:t>Resolved comment.</w:t></w:r></w:p>
      </w:comment>
      <w:comment w:id="1" w:author="Bob">
        <w:p w14:paraId="CCDD3344"><w:r><w:t>Open comment.</w:t></w:r></w:p>
      </w:comment>
    </w:comments>`;
    const extendedXml = `<?xml version="1.0"?><w15:commentsEx xmlns:w15="${NS_W15}">
      <w15:commentEx w15:paraId="AABB1122" w15:done="1"/>
      <w15:commentEx w15:paraId="CCDD3344" w15:done="0"/>
    </w15:commentsEx>`;
    const out = parseCommentsXml(commentsXml, ctx, extendedXml);
    expect(out[0]?.done).toBe(true);
    expect(out[1]?.done).toBeUndefined();
  });

  it("resolves paraIdParent into Comment.replyToId", () => {
    const NS_W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
    const NS_W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
    const commentsXml = `<?xml version="1.0"?><w:comments xmlns:w="${NS_W}" xmlns:w14="${NS_W14}">
      <w:comment w:id="0" w:author="Alice">
        <w:p w14:paraId="P000"><w:r><w:t>Top-level question.</w:t></w:r></w:p>
      </w:comment>
      <w:comment w:id="1" w:author="Bob">
        <w:p w14:paraId="P111"><w:r><w:t>Reply from Bob.</w:t></w:r></w:p>
      </w:comment>
      <w:comment w:id="2" w:author="Carol">
        <w:p w14:paraId="P222"><w:r><w:t>Reply from Carol.</w:t></w:r></w:p>
      </w:comment>
    </w:comments>`;
    const extendedXml = `<?xml version="1.0"?><w15:commentsEx xmlns:w15="${NS_W15}">
      <w15:commentEx w15:paraId="P000"/>
      <w15:commentEx w15:paraId="P111" w15:paraIdParent="P000"/>
      <w15:commentEx w15:paraId="P222" w15:paraIdParent="P000"/>
    </w15:commentsEx>`;
    const out = parseCommentsXml(commentsXml, ctx, extendedXml);
    expect(out[0]?.replyToId).toBeUndefined();
    expect(out[1]?.replyToId).toBe(0);
    expect(out[2]?.replyToId).toBe(0);
  });

  it("ignores paraIdParent pointing at an unknown paraId", () => {
    const NS_W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
    const NS_W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
    const commentsXml = `<?xml version="1.0"?><w:comments xmlns:w="${NS_W}" xmlns:w14="${NS_W14}">
      <w:comment w:id="0" w:author="Alice">
        <w:p w14:paraId="P000"><w:r><w:t>Orphan reply.</w:t></w:r></w:p>
      </w:comment>
    </w:comments>`;
    const extendedXml = `<?xml version="1.0"?><w15:commentsEx xmlns:w15="${NS_W15}">
      <w15:commentEx w15:paraId="P000" w15:paraIdParent="NOSUCH"/>
    </w15:commentsEx>`;
    const out = parseCommentsXml(commentsXml, ctx, extendedXml);
    expect(out[0]?.replyToId).toBeUndefined();
  });

  it("leaves comments un-marked when commentsExtended is missing", () => {
    const NS_W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
    const xml = `<?xml version="1.0"?><w:comments xmlns:w="${NS_W}" xmlns:w14="${NS_W14}">
      <w:comment w:id="0" w:author="Alice">
        <w:p w14:paraId="AABB1122"><w:r><w:t>Hi.</w:t></w:r></w:p>
      </w:comment>
    </w:comments>`;
    const out = parseCommentsXml(xml, ctx);
    expect(out[0]?.done).toBeUndefined();
  });
});

describe("readParagraph — comment ranges", () => {
  it("tags runs between commentRangeStart and commentRangeEnd", () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:p xmlns:w="${NS_W}">
        <w:r><w:t>before </w:t></w:r>
        <w:commentRangeStart w:id="0"/>
        <w:r><w:t>commented</w:t></w:r>
        <w:commentRangeEnd w:id="0"/>
        <w:r><w:t> after</w:t></w:r>
      </w:p>`,
      "application/xml",
    );
    const { items } = readParagraph(doc.documentElement);
    expect(items).toHaveLength(3);
    expect((items[0] as { run: { commentIds?: unknown } }).run.commentIds).toBeUndefined();
    expect((items[1] as { run: { commentIds?: unknown } }).run.commentIds).toEqual([0]);
    expect((items[2] as { run: { commentIds?: unknown } }).run.commentIds).toBeUndefined();
  });

  it("preserves activeComments across paragraphs when caller threads the set", () => {
    // Manually thread one set across two paragraphs: opens in para 1,
    // closes in para 2 — the middle of para 2 must still be tagged.
    const wrap = (xml: string) =>
      new DOMParser().parseFromString(`<?xml version="1.0"?>${xml}`, "application/xml")
        .documentElement;
    const p1 = wrap(`<w:p xmlns:w="${NS_W}">
      <w:r><w:t>before </w:t></w:r>
      <w:commentRangeStart w:id="0"/>
      <w:r><w:t>start of comment</w:t></w:r>
    </w:p>`);
    const p2 = wrap(`<w:p xmlns:w="${NS_W}">
      <w:r><w:t>middle of comment</w:t></w:r>
      <w:commentRangeEnd w:id="0"/>
      <w:r><w:t> after</w:t></w:r>
    </w:p>`);
    const active = new Set<number>();
    const p1Items = readParagraph(p1, active).items;
    const p2Items = readParagraph(p2, active).items;
    // p1: "before" untagged, "start of comment" tagged
    expect((p1Items[0] as { run: { commentIds?: unknown } }).run.commentIds).toBeUndefined();
    expect((p1Items[1] as { run: { commentIds?: unknown } }).run.commentIds).toEqual([0]);
    // p2: "middle of comment" tagged (set is still active!), " after" untagged
    expect((p2Items[0] as { run: { commentIds?: unknown } }).run.commentIds).toEqual([0]);
    expect((p2Items[1] as { run: { commentIds?: unknown } }).run.commentIds).toBeUndefined();
  });

  it("convertDocumentXml propagates cross-paragraph comment ranges automatically", () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="${NS_W}"><w:body>
      <w:p>
        <w:commentRangeStart w:id="9"/>
        <w:r><w:t>spans</w:t></w:r>
      </w:p>
      <w:p>
        <w:r><w:t>across</w:t></w:r>
      </w:p>
      <w:p>
        <w:r><w:t>three paragraphs</w:t></w:r>
        <w:commentRangeEnd w:id="9"/>
      </w:p>
    </w:body></w:document>`;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const { body } = convertDocumentXml(doc, ctx);
    // Read the commentIds off the first run of every paragraph.
    const ids = body.map((b) =>
      b.kind === "paragraph"
        ? (b.runs[0] as { properties?: { commentIds?: unknown } } | undefined)?.properties
            ?.commentIds
        : undefined,
    );
    expect(ids).toEqual([[9], [9], [9]]);
  });

  it("tags runs covered by multiple overlapping comment ranges", () => {
    const doc = new DOMParser().parseFromString(
      `<?xml version="1.0"?><w:p xmlns:w="${NS_W}">
        <w:commentRangeStart w:id="0"/>
        <w:r><w:t>a</w:t></w:r>
        <w:commentRangeStart w:id="1"/>
        <w:r><w:t>b</w:t></w:r>
        <w:commentRangeEnd w:id="0"/>
        <w:r><w:t>c</w:t></w:r>
        <w:commentRangeEnd w:id="1"/>
      </w:p>`,
      "application/xml",
    );
    const { items } = readParagraph(doc.documentElement);
    expect(items).toHaveLength(3);
    expect((items[0] as { run: { commentIds?: unknown } }).run.commentIds).toEqual([0]);
    expect((items[1] as { run: { commentIds?: unknown } }).run.commentIds).toEqual([0, 1]);
    expect((items[2] as { run: { commentIds?: unknown } }).run.commentIds).toEqual([1]);
  });
});
