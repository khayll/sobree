import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, table, tableCell, tableRow, text } from "../../doc/builders";
import type { Paragraph, SobreeDocument, Table } from "../../doc/types";
import { importDocx } from "../import";
import { convertBlocksFromContainer } from "../import/document";
import { parseXml } from "../shared/xml";
import { exportDocx } from "./index";

/**
 * SDT (content-control) pass-through: the importer flattens `<w:sdt>`
 * wrappers but records membership + the verbatim `<w:sdtPr>` on each
 * flattened block; the exporter re-groups consecutive members and
 * re-emits the control. Round-trip suites drive real exportDocx →
 * importDocx bytes; the flatten-side shapes (nested controls, mixed
 * content) drive the container converter on raw Word XML.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PR = `<w:sdtPr xmlns:w="${W}"><w:alias w:val="Applicant"/><w:tag w:val="name"/></w:sdtPr>`;

async function roundTrip(doc: SobreeDocument): Promise<SobreeDocument> {
  return (await importDocx(exportDocx(doc).bytes)).document;
}

describe("SDT pass-through round-trip", () => {
  it("a control spanning paragraphs and a table survives as ONE control, sdtPr verbatim", async () => {
    const doc = emptyDocument();
    const wrap = { id: 0, prXml: PR };
    doc.body = [
      { ...paragraph([text("name line")], { sdt: wrap }) },
      (() => {
        const t = table([tableRow([tableCell([paragraph([text("cell")])])])]);
        t.properties.sdt = wrap;
        return t;
      })(),
      { ...paragraph([text("after in control")], { sdt: wrap }) },
      paragraph([text("outside")]),
    ];

    const back = await roundTrip(doc);

    const members = back.body.filter((b) => (b as Paragraph | Table).properties.sdt !== undefined);
    expect(members).toHaveLength(3);
    const ids = new Set(members.map((b) => (b as Paragraph).properties.sdt!.id));
    expect(ids.size).toBe(1); // one control, not three
    const prXml = (members[0] as Paragraph).properties.sdt!.prXml;
    expect(prXml).toContain("Applicant");
    expect(prXml).toContain("w:tag");
    expect((back.body[3] as Paragraph).properties.sdt).toBeUndefined();

    // Stability: a SECOND cycle reproduces the identical prXml — the
    // serialize(parse(x)) form is a fixpoint after one pass.
    const again = await roundTrip(back);
    expect(
      (again.body.filter((b) => (b as Paragraph).properties.sdt) as Paragraph[])[0]!.properties.sdt!
        .prXml,
    ).toBe(
      (back.body.filter((b) => (b as Paragraph).properties.sdt) as Paragraph[])[0]!.properties.sdt!
        .prXml,
    );
  });

  it("ADJACENT controls with identical properties stay two controls", async () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([text("first control")], { sdt: { id: 0, prXml: PR } }),
      paragraph([text("second control")], { sdt: { id: 1, prXml: PR } }),
    ];

    const back = await roundTrip(doc);

    const ids = back.body.map((b) => (b as Paragraph).properties.sdt?.id);
    expect(ids[0]).toBeDefined();
    expect(ids[1]).toBeDefined();
    expect(ids[0]).not.toBe(ids[1]); // two wrappers were emitted and re-read
  });

  it("a membership-less block SPLITS the control instead of corrupting it", async () => {
    const doc = emptyDocument();
    const wrap = { id: 0, prXml: PR };
    doc.body = [
      paragraph([text("head")], { sdt: wrap }),
      paragraph([text("typed into the middle")]), // no membership — an edit
      paragraph([text("tail")], { sdt: wrap }),
    ];

    const back = await roundTrip(doc);

    const head = back.body[0] as Paragraph;
    const middle = back.body[1] as Paragraph;
    const tail = back.body[2] as Paragraph;
    expect(head.properties.sdt).toBeDefined();
    expect(middle.properties.sdt).toBeUndefined();
    expect(tail.properties.sdt).toBeDefined();
    expect(head.properties.sdt!.id).not.toBe(tail.properties.sdt!.id); // split into two controls
  });
});

describe("SDT flattening records membership (Word-shaped XML)", () => {
  function bodyOf(xml: string) {
    const doc = parseXml(`<w:body xmlns:w="${W}">${xml}</w:body>`);
    return convertBlocksFromContainer(doc.documentElement, { rels: new Map() } as never).body;
  }

  it("nested controls attribute to the OUTERMOST wrapper", () => {
    const blocks = bodyOf(
      '<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>' +
        "<w:p><w:r><w:t>a</w:t></w:r></w:p>" +
        '<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>' +
        "<w:p><w:r><w:t>b</w:t></w:r></w:p>" +
        "</w:sdtContent></w:sdt>" +
        "</w:sdtContent></w:sdt>",
    );

    expect(blocks).toHaveLength(2);
    const [a, b] = blocks as Paragraph[];
    expect(a!.properties.sdt).toBeDefined();
    expect(b!.properties.sdt).toBeDefined();
    expect(a!.properties.sdt!.id).toBe(b!.properties.sdt!.id); // one owner: the outer control
    expect(a!.properties.sdt!.prXml).toContain("outer");
    expect(a!.properties.sdt!.prXml).not.toContain("inner");
  });

  it("content around a control stays membership-free", () => {
    const blocks = bodyOf(
      "<w:p><w:r><w:t>before</w:t></w:r></w:p>" +
        '<w:sdt><w:sdtPr><w:tag w:val="x"/></w:sdtPr><w:sdtContent>' +
        "<w:p><w:r><w:t>inside</w:t></w:r></w:p>" +
        "</w:sdtContent></w:sdt>" +
        "<w:p><w:r><w:t>after</w:t></w:r></w:p>",
    );

    expect((blocks[0] as Paragraph).properties.sdt).toBeUndefined();
    expect((blocks[1] as Paragraph).properties.sdt).toBeDefined();
    expect((blocks[2] as Paragraph).properties.sdt).toBeUndefined();
  });
});
