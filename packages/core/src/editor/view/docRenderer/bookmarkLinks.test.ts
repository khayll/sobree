import { describe, expect, it } from "vitest";
import { emptyDocument, paragraph, text } from "../../../doc/builders";
import { serializeHostsToDocument } from "../docSerialize/index";
import { renderSobreeDocument } from "./index";

/**
 * Render ↔ read-back proof for the bookmark/PAGEREF substrate: markers
 * become addressable zero-width spans, internal hyperlinks point at
 * them, field spans carry their instruction — and ALL of it survives
 * the DOM serializer (the read-back gap noted when markers landed).
 */
describe("bookmark + internal link rendering", () => {
  function renderedHost() {
    const doc = emptyDocument();
    doc.body = [
      paragraph([
        {
          kind: "hyperlink",
          href: "#_Toc1",
          children: [
            text("Chapter One"),
            { kind: "field", instruction: "PAGEREF _Toc1 \\h", cached: "5" },
          ],
        },
      ]),
      paragraph([
        { kind: "bookmarkStart", id: 1, name: "_Toc1" },
        text("Chapter One heading"),
        { kind: "bookmarkEnd", id: 1 },
      ]),
    ];
    const host = document.createElement("div");
    renderSobreeDocument(doc, host);
    return host;
  }

  it("renders the marker as an addressable span and the link resolves to it", () => {
    const host = renderedHost();

    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("#sobree-bookmark-_Toc1");
    const marker = host.querySelector("#sobree-bookmark-_Toc1");
    expect(marker?.getAttribute("data-name")).toBe("_Toc1");
    expect(marker?.textContent).toBe("");

    const field = host.querySelector<HTMLElement>("[data-field]");
    expect(field?.dataset.field).toBe("PAGEREF _Toc1 \\h");
    expect(field?.textContent).toBe("5");
  });

  it("DOM read-back reconstructs markers, the model href, and the field", () => {
    const host = renderedHost();
    const back = serializeHostsToDocument([host]);

    const [entry, headingP] = back.body;
    expect(entry?.kind).toBe("paragraph");
    if (entry?.kind !== "paragraph" || headingP?.kind !== "paragraph") throw new Error("shape");

    const link = entry.runs.find((r) => r.kind === "hyperlink");
    expect(link?.kind === "hyperlink" && link.href).toBe("#_Toc1");
    const field = link?.kind === "hyperlink" && link.children.find((r) => r.kind === "field");
    expect(field).toMatchObject({ instruction: "PAGEREF _Toc1 \\h", cached: "5" });

    expect(headingP.runs.map((r) => r.kind)).toEqual(["bookmarkStart", "text", "bookmarkEnd"]);
    const start = headingP.runs[0];
    expect(start?.kind === "bookmarkStart" && start.name).toBe("_Toc1");
    expect(start?.kind === "bookmarkStart" && start.id).toBe(1);
  });
});
