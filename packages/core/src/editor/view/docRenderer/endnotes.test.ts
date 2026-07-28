import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../../../doc/builders";
import { renderSobreeDocument } from "./index";

/**
 * Rendering proof for endnotes: the reference mark is a clickable
 * superscript whose href resolves to the matching `<li>` in the
 * `sobree-endnotes` aside appended at the document end.
 */
describe("endnote rendering", () => {
  it("renders the ref mark and a document-end aside with matching anchors", () => {
    const doc = emptyDocument();
    doc.body = [paragraph([text("body"), { kind: "endnoteRef", id: 3 }])];
    doc.endnotes = { 3: [paragraph([text("the note")])] };

    const host = document.createElement("div");
    renderSobreeDocument(doc, host);

    const link = host.querySelector("sup.sobree-endnote-ref a");
    expect(link?.getAttribute("href")).toBe("#sobree-endnote-3");
    expect(link?.textContent).toBe("3");

    const aside = host.querySelector("aside.sobree-endnotes");
    expect(aside).not.toBeNull();
    // The aside must come AFTER the footnotes aside slot / body content.
    expect(host.lastElementChild).toBe(aside);
    const li = aside?.querySelector("li#sobree-endnote-3");
    expect(li?.textContent).toContain("the note");
  });

  it("renders a custom mark instead of the number when present", () => {
    const doc = emptyDocument();
    doc.body = [paragraph([{ kind: "endnoteRef", id: 1, customMark: "†" }])];
    doc.endnotes = { 1: [paragraph([text("daggered")])] };

    const host = document.createElement("div");
    renderSobreeDocument(doc, host);

    expect(host.querySelector("sup.sobree-endnote-ref a")?.textContent).toBe("†");
  });

  it("renders footnote and endnote asides together, footnotes first", () => {
    const doc = emptyDocument();
    doc.body = [
      paragraph([text("x"), { kind: "footnoteRef", id: 1 }, { kind: "endnoteRef", id: 1 }]),
    ];
    doc.footnotes = { 1: [paragraph([text("foot")])] };
    doc.endnotes = { 1: [paragraph([text("end")])] };

    const host = document.createElement("div");
    renderSobreeDocument(doc, host);

    const asides = [...host.querySelectorAll("aside")].map((a) => a.className);
    expect(asides).toEqual(["sobree-footnotes", "sobree-endnotes"]);
  });
});
