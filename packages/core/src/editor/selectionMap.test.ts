import { describe, expect, it } from "vitest";
import { applySelectionDescriptor, captureSelectionDescriptor } from "./selectionMap";

describe("selectionMap — selection descriptor survives a DOM rebuild", () => {
  // Repagination rebuilds the paper DOM (new nodes, same data-block-id). A
  // raw-node Range would be lost; the model descriptor re-resolves by id.
  function place(node: Node, offset: number): void {
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  }
  function landedBlockId(): string | null | undefined {
    const live = window.getSelection()!;
    const an = live.anchorNode;
    const el = an?.nodeType === Node.TEXT_NODE ? an.parentElement : (an as Element | null);
    return el?.closest("[data-block-id]")?.getAttribute("data-block-id");
  }

  it("re-resolves a paragraph caret by id after the nodes are recreated", () => {
    const host = document.createElement("div");
    host.innerHTML = `<p data-block-id="b1" data-block-index="0">Field Almanac</p>`;
    document.body.appendChild(host);
    place(host.querySelector("p")!.firstChild!, 5);

    const desc = captureSelectionDescriptor([host]);
    expect(desc?.start.blockId).toBe("b1");
    expect(desc?.start.offset).toBe(5);

    // Rebuild the DOM with FRESH nodes carrying the same id (like repaginate).
    host.innerHTML = `<div class="paper"><div class="paper-content"><p data-block-id="b1" data-block-index="0">Field Almanac</p></div></div>`;
    expect(applySelectionDescriptor([host], desc)).toBe(true);
    expect(landedBlockId()).toBe("b1");
    expect(window.getSelection()!.anchorOffset).toBe(5);
  });

  it("re-resolves a table-cell caret to the same cell after a rebuild", () => {
    const host = document.createElement("div");
    host.innerHTML = `<table data-block-id="t1" data-block-index="0"><tbody>
      <tr><td><p>a</p></td><td><p>Cirrus</p></td></tr></tbody></table>`;
    document.body.appendChild(host);
    const cellP = (host.querySelectorAll("td")[1] as HTMLElement).querySelector("p")!;
    place(cellP.firstChild!, 6);

    const desc = captureSelectionDescriptor([host]);
    expect(desc?.start.blockId).toBe("t1");
    expect(desc?.start.cell).toEqual({ row: 0, col: 1, blockIndex: 0 });

    host.innerHTML = `<div class="paper"><table data-block-id="t1" data-block-index="0"><tbody>
      <tr><td><p>a</p></td><td><p>Cirrus</p></td></tr></tbody></table></div>`;
    expect(applySelectionDescriptor([host], desc)).toBe(true);
    const an = window.getSelection()!.anchorNode;
    const el = an?.nodeType === Node.TEXT_NODE ? an.parentElement : (an as Element | null);
    expect(el?.closest("td")?.textContent).toBe("Cirrus");
  });
});
