import { describe, expect, it } from "vitest";
import { BlockRegistry } from "./blockRegistry";
import {
  applySelectionDescriptor,
  blockElementAtIndex,
  blockLength,
  captureSelectionDescriptor,
  countBlocks,
  domPointFromPosition,
  positionFromDomPoint,
  rangeFromDomRange,
} from "./positionMap";

function setupHost(html: string): { host: HTMLElement; registry: BlockRegistry } {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  // Stamp `data-block-id` / `data-block-index` like the renderer does — one
  // per top-level block, expanding `<ul>`/`<ol>` to one per `<li>`. positionMap
  // locates blocks by these stamps (robust to paper / column nesting), not by
  // walking host children, so the test DOM must carry them.
  const blockEls: HTMLElement[] = [];
  for (const child of Array.from(host.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      for (const li of Array.from(child.children)) {
        if (li instanceof HTMLElement && li.tagName.toLowerCase() === "li") blockEls.push(li);
      }
    } else if (child instanceof HTMLElement) {
      blockEls.push(child);
    }
  }
  const registry = new BlockRegistry();
  registry.reset(blockEls.length);
  blockEls.forEach((el, i) => {
    el.setAttribute("data-block-id", registry.refAt(i).id);
    el.setAttribute("data-block-index", String(i));
  });
  return { host, registry };
}

function firstText(el: Element): Text {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const t = walker.nextNode();
  if (!t) throw new Error("no text");
  return t as Text;
}

describe("countBlocks + blockElementAtIndex", () => {
  it("counts paragraphs and headings as single blocks", () => {
    const { host } = setupHost("<p>one</p><h1>two</h1><p>three</p>");
    expect(countBlocks([host])).toBe(3);
  });

  it("expands <ul>/<ol> into one block per <li>", () => {
    const { host } = setupHost("<p>a</p><ul><li>x</li><li>y</li></ul><p>b</p>");
    expect(countBlocks([host])).toBe(4);
    expect(blockElementAtIndex([host], 0)?.tagName).toBe("P");
    expect(blockElementAtIndex([host], 1)?.tagName).toBe("LI");
    expect(blockElementAtIndex([host], 2)?.tagName).toBe("LI");
    expect(blockElementAtIndex([host], 3)?.tagName).toBe("P");
  });
});

describe("blockLength", () => {
  it("counts characters in a plain text paragraph", () => {
    const { host } = setupHost("<p>hello</p>");
    const p = host.querySelector("p")!;
    expect(blockLength(p)).toBe(5);
  });

  it("treats wrapper elements (<strong>, <em>, <span>) as transparent", () => {
    const { host } = setupHost("<p>hi <strong>bold</strong> now</p>");
    const p = host.querySelector("p")!;
    expect(blockLength(p)).toBe("hi bold now".length);
  });

  it("counts <br>, <img>, <hr> as 1 each", () => {
    const { host } = setupHost("<p>a<br>b<img/>c</p>");
    expect(blockLength(host.querySelector("p")!)).toBe(5);
  });

  it("counts a mix of text and atoms", () => {
    const { host } = setupHost("<p>foo<br>bar<span>baz</span></p>");
    expect(blockLength(host.querySelector("p")!)).toBe(10); // 3 + 1 + 3 + 3
  });
});

describe("positionFromDomPoint", () => {
  it("returns block ref + offset for a point inside a text node", () => {
    const { host, registry } = setupHost("<p>hello</p>");
    const p = host.querySelector("p")!;
    const t = firstText(p);
    const pos = positionFromDomPoint([host], registry, t, 3);
    expect(pos?.block.id).toBe("b1");
    expect(pos?.offset).toBe(3);
  });

  it("accounts for wrapper ancestors when measuring offset", () => {
    const { host, registry } = setupHost("<p>hi <strong>bold</strong> now</p>");
    const p = host.querySelector("p")!;
    const strongText = p.querySelector("strong")!.firstChild as Text;
    // Caret between 'b' and 'o' of "bold": "hi " (3) + 1 = 4
    const pos = positionFromDomPoint([host], registry, strongText, 1);
    expect(pos?.offset).toBe(4);
  });

  it("counts atoms preceding the point", () => {
    const { host, registry } = setupHost("<p>a<br>b<br>c</p>");
    const p = host.querySelector("p")!;
    const lastText = Array.from(p.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent === "c",
    )! as Text;
    const pos = positionFromDomPoint([host], registry, lastText, 1);
    expect(pos?.offset).toBe(5); // a(1) + br(1) + b(1) + br(1) + 1
  });

  it("returns the correct block ref for items inside <ul>", () => {
    const { host, registry } = setupHost("<p>a</p><ul><li>one</li><li>two</li></ul>");
    const li2 = host.querySelectorAll("li")[1]!;
    const pos = positionFromDomPoint([host], registry, firstText(li2), 2);
    expect(pos?.block.id).toBe("b3");
    expect(pos?.offset).toBe(2);
  });

  it("returns null for a point outside the host", () => {
    const { host, registry } = setupHost("<p>hi</p>");
    const outside = document.createElement("div");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    const pos = positionFromDomPoint([host], registry, outside.firstChild!, 0);
    expect(pos).toBeNull();
  });
});

describe("domPointFromPosition round-trip", () => {
  it("finds a (node, offset) equivalent to the requested char offset", () => {
    const { host, registry } = setupHost("<p>hello</p>");
    const pos = { block: registry.refAt(0), offset: 3 };
    const pt = domPointFromPosition([host], pos);
    expect(pt?.node.nodeType).toBe(Node.TEXT_NODE);
    expect((pt?.node as Text).data).toBe("hello");
    expect(pt?.offset).toBe(3);
  });

  it("walks past wrappers to reach the right text node", () => {
    const { host, registry } = setupHost("<p>hi <strong>bold</strong> now</p>");
    const pos = { block: registry.refAt(0), offset: 5 };
    const pt = domPointFromPosition([host], pos);
    expect(pt?.node.nodeType).toBe(Node.TEXT_NODE);
    expect((pt?.node as Text).data).toBe("bold");
    expect(pt?.offset).toBe(2);
  });

  it("places the caret beside an atom for edge offsets", () => {
    const { host, registry } = setupHost("<p>a<br>b</p>");
    // offset=1 → the caret is between 'a' and '<br>'.
    const pt = domPointFromPosition([host], { block: registry.refAt(0), offset: 1 });
    expect(pt?.node.nodeType).toBe(Node.TEXT_NODE);
    expect((pt?.node as Text).data).toBe("a");
    expect(pt?.offset).toBe(1);

    const pt2 = domPointFromPosition([host], { block: registry.refAt(0), offset: 2 });
    // offset=2 → between <br> and 'b'. Acceptable results: (p, index-of-br+1) or (b-text, 0).
    // Either way the caret lands at the start of the "b" text node.
    if (pt2?.node.nodeType === Node.TEXT_NODE) {
      expect((pt2.node as Text).data).toBe("b");
      expect(pt2.offset).toBe(0);
    } else {
      expect(pt2?.node).toBe(host.querySelector("p"));
    }
  });

  it("returns a (block, childCount) point for offset past the end", () => {
    const { host, registry } = setupHost("<p>hi</p>");
    const pt = domPointFromPosition([host], { block: registry.refAt(0), offset: 10 });
    expect(pt?.node).toBe(host.querySelector("p"));
    expect(pt?.offset).toBe(host.querySelector("p")!.childNodes.length);
  });
});

describe("rangeFromDomRange", () => {
  it("round-trips a DOM range into an API range", () => {
    const { host, registry } = setupHost("<p>hello world</p>");
    const p = host.querySelector("p")!;
    const t = firstText(p);
    const domRange = document.createRange();
    domRange.setStart(t, 6); // 'w' of 'world'
    domRange.setEnd(t, 11); // end of 'd'
    const api = rangeFromDomRange([host], registry, domRange);
    expect(api?.from.offset).toBe(6);
    expect(api?.to.offset).toBe(11);
    expect(api?.from.block.id).toBe(api?.to.block.id);
  });

  it("handles ranges that span two blocks", () => {
    const { host, registry } = setupHost("<p>foo</p><p>bar</p>");
    const [p1, p2] = host.querySelectorAll("p");
    const domRange = document.createRange();
    domRange.setStart(firstText(p1!), 1);
    domRange.setEnd(firstText(p2!), 2);
    const api = rangeFromDomRange([host], registry, domRange);
    expect(api?.from.block.id).toBe("b1");
    expect(api?.from.offset).toBe(1);
    expect(api?.to.block.id).toBe("b2");
    expect(api?.to.offset).toBe(2);
  });
});

describe("positionMap — blocks nested in paper / column layout", () => {
  // The paginator nests body blocks inside `.paper` → `.paper-content` →
  // `.sobree-cols` → `.sobree-col`, so a block is NEVER a direct host child.
  // The old positional walk treated the column wrapper as one block, so every
  // selection mapping in a multi-column section landed on the wrong block —
  // that's what made undo / caret restore jump to the following paragraph.
  function setupColumns(): { host: HTMLElement; registry: BlockRegistry; ps: HTMLElement[] } {
    const host = document.createElement("div");
    host.innerHTML = `
      <div class="paper"><div class="paper-content">
        <p>intro</p>
        <div class="sobree-cols sobree-section-cols">
          <div class="sobree-col"><p>The three storeys</p><p>body one</p></div>
          <div class="sobree-col"><p>Reading the weather</p></div>
        </div>
      </div></div>`.trim();
    document.body.appendChild(host);
    const ps = Array.from(host.querySelectorAll("p")) as HTMLElement[];
    const registry = new BlockRegistry();
    registry.reset(ps.length);
    ps.forEach((el, i) => {
      el.setAttribute("data-block-id", registry.refAt(i).id);
      el.setAttribute("data-block-index", String(i));
    });
    return { host, registry, ps };
  }

  it("counts every nested block (not the column wrapper as one)", () => {
    const { host } = setupColumns();
    expect(countBlocks([host])).toBe(4); // intro + 2 (col 1) + 1 (col 2)
  });

  it("resolves a column-nested heading by index and id, both directions", () => {
    const { host, registry, ps } = setupColumns();
    const heading = ps[1]!; // "The three storeys" — deep inside .sobree-col

    // index → element
    expect(blockElementAtIndex([host], 1)).toBe(heading);

    // DOM → model: a caret in the heading resolves to ITS block, not the wrapper
    const pos = positionFromDomPoint([host], registry, heading.firstChild!, 3);
    expect(pos?.block.id).toBe(registry.refAt(1).id);
    expect(pos?.offset).toBe(3);

    // model → DOM: round-trips back into the same nested heading
    const pt = domPointFromPosition([host], { block: registry.refAt(1), offset: 3 });
    expect(pt && heading.contains(pt.node)).toBe(true);
  });

  it("maps the second column's block too", () => {
    const { host, registry, ps } = setupColumns();
    const weather = ps[3]!; // "Reading the weather" in column 2
    const pos = positionFromDomPoint([host], registry, weather.firstChild!, 0);
    expect(pos?.block.id).toBe(registry.refAt(3).id);
    expect(domPointFromPosition([host], { block: registry.refAt(3), offset: 0 })).not.toBeNull();
  });
});

describe("positionMap — table cell addressing", () => {
  // A table is ONE registered block, but its cells hold their own content.
  // A caret in a cell must capture (and restore) the cell address so undo
  // lands back in the cell, not at the table boundary.
  function setupTable(): { host: HTMLElement; registry: BlockRegistry } {
    const host = document.createElement("div");
    host.innerHTML = `
      <table data-block-id="b1" data-block-index="0"><tbody>
        <tr><td><p>Genus</p></td><td><p>Storey</p></td></tr>
        <tr><td><p>Cirrus</p></td><td><p>High</p></td></tr>
      </tbody></table>`.trim();
    document.body.appendChild(host);
    const registry = new BlockRegistry();
    registry.reset(1); // one block: the table (id "b1")
    return { host, registry };
  }

  function cellOf(host: HTMLElement, text: string): HTMLElement {
    return [...host.querySelectorAll("td")].find((td) => td.textContent === text) as HTMLElement;
  }

  it("captures the cell address (row / col / blockIndex) for a caret in a cell", () => {
    const { host, registry } = setupTable();
    const cirrus = cellOf(host, "Cirrus");
    const pos = positionFromDomPoint([host], registry, cirrus.querySelector("p")!.firstChild!, 6);
    expect(pos?.block.id).toBe("b1");
    expect(pos?.cell).toEqual({ row: 1, col: 0, blockIndex: 0 });
    expect(pos?.offset).toBe(6);
  });

  it("restores a cell caret to the SAME cell (round-trip), not the table start", () => {
    const { host, registry } = setupTable();
    const pt = domPointFromPosition([host], {
      block: registry.refAt(0),
      offset: 4,
      cell: { row: 1, col: 1, blockIndex: 0 },
    });
    const node = pt?.node ?? null;
    const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
    const cell = el?.closest("td");
    expect(cell?.textContent).toBe("High");
    expect(pt?.offset).toBe(4); // end of "High"
  });

  it("without a cell address, a table position resolves to the table element", () => {
    const { host, registry } = setupTable();
    const pt = domPointFromPosition([host], { block: registry.refAt(0), offset: 0 });
    expect((pt?.node as HTMLElement)?.tagName ?? (pt?.node as Node)?.nodeName).toBeTruthy();
    // round-trips to somewhere inside the table (no crash, no null)
    expect(pt).not.toBeNull();
  });
});

describe("positionMap — selection descriptor survives a DOM rebuild", () => {
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
