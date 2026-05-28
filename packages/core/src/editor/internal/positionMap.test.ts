import { BlockRegistry } from "./blockRegistry";
import {
  blockElementAtIndex,
  blockLength,
  countBlocks,
  domPointFromPosition,
  positionFromDomPoint,
  rangeFromDomRange,
} from "./positionMap";
import { describe, expect, it } from "vitest";

function setupHost(html: string): { host: HTMLElement; registry: BlockRegistry } {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  const registry = new BlockRegistry();
  registry.reset(countBlocks([host]));
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
    const { host } = setupHost(`<p>one</p><h1>two</h1><p>three</p>`);
    expect(countBlocks([host])).toBe(3);
  });

  it("expands <ul>/<ol> into one block per <li>", () => {
    const { host } = setupHost(`<p>a</p><ul><li>x</li><li>y</li></ul><p>b</p>`);
    expect(countBlocks([host])).toBe(4);
    expect(blockElementAtIndex([host], 0)?.tagName).toBe("P");
    expect(blockElementAtIndex([host], 1)?.tagName).toBe("LI");
    expect(blockElementAtIndex([host], 2)?.tagName).toBe("LI");
    expect(blockElementAtIndex([host], 3)?.tagName).toBe("P");
  });
});

describe("blockLength", () => {
  it("counts characters in a plain text paragraph", () => {
    const { host } = setupHost(`<p>hello</p>`);
    const p = host.querySelector("p")!;
    expect(blockLength(p)).toBe(5);
  });

  it("treats wrapper elements (<strong>, <em>, <span>) as transparent", () => {
    const { host } = setupHost(`<p>hi <strong>bold</strong> now</p>`);
    const p = host.querySelector("p")!;
    expect(blockLength(p)).toBe("hi bold now".length);
  });

  it("counts <br>, <img>, <hr> as 1 each", () => {
    const { host } = setupHost(`<p>a<br>b<img/>c</p>`);
    expect(blockLength(host.querySelector("p")!)).toBe(5);
  });

  it("counts a mix of text and atoms", () => {
    const { host } = setupHost(`<p>foo<br>bar<span>baz</span></p>`);
    expect(blockLength(host.querySelector("p")!)).toBe(10); // 3 + 1 + 3 + 3
  });
});

describe("positionFromDomPoint", () => {
  it("returns block ref + offset for a point inside a text node", () => {
    const { host, registry } = setupHost(`<p>hello</p>`);
    const p = host.querySelector("p")!;
    const t = firstText(p);
    const pos = positionFromDomPoint([host], registry, t, 3);
    expect(pos?.block.id).toBe("b1");
    expect(pos?.offset).toBe(3);
  });

  it("accounts for wrapper ancestors when measuring offset", () => {
    const { host, registry } = setupHost(`<p>hi <strong>bold</strong> now</p>`);
    const p = host.querySelector("p")!;
    const strongText = p.querySelector("strong")!.firstChild as Text;
    // Caret between 'b' and 'o' of "bold": "hi " (3) + 1 = 4
    const pos = positionFromDomPoint([host], registry, strongText, 1);
    expect(pos?.offset).toBe(4);
  });

  it("counts atoms preceding the point", () => {
    const { host, registry } = setupHost(`<p>a<br>b<br>c</p>`);
    const p = host.querySelector("p")!;
    const lastText = Array.from(p.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent === "c",
    )! as Text;
    const pos = positionFromDomPoint([host], registry, lastText, 1);
    expect(pos?.offset).toBe(5); // a(1) + br(1) + b(1) + br(1) + 1
  });

  it("returns the correct block ref for items inside <ul>", () => {
    const { host, registry } = setupHost(`<p>a</p><ul><li>one</li><li>two</li></ul>`);
    const li2 = host.querySelectorAll("li")[1]!;
    const pos = positionFromDomPoint([host], registry, firstText(li2), 2);
    expect(pos?.block.id).toBe("b3");
    expect(pos?.offset).toBe(2);
  });

  it("returns null for a point outside the host", () => {
    const { host, registry } = setupHost(`<p>hi</p>`);
    const outside = document.createElement("div");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    const pos = positionFromDomPoint([host], registry, outside.firstChild!, 0);
    expect(pos).toBeNull();
  });
});

describe("domPointFromPosition round-trip", () => {
  it("finds a (node, offset) equivalent to the requested char offset", () => {
    const { host, registry } = setupHost(`<p>hello</p>`);
    const pos = { block: registry.refAt(0), offset: 3 };
    const pt = domPointFromPosition([host], registry, pos);
    expect(pt?.node.nodeType).toBe(Node.TEXT_NODE);
    expect((pt?.node as Text).data).toBe("hello");
    expect(pt?.offset).toBe(3);
  });

  it("walks past wrappers to reach the right text node", () => {
    const { host, registry } = setupHost(`<p>hi <strong>bold</strong> now</p>`);
    const pos = { block: registry.refAt(0), offset: 5 };
    const pt = domPointFromPosition([host], registry, pos);
    expect(pt?.node.nodeType).toBe(Node.TEXT_NODE);
    expect((pt?.node as Text).data).toBe("bold");
    expect(pt?.offset).toBe(2);
  });

  it("places the caret beside an atom for edge offsets", () => {
    const { host, registry } = setupHost(`<p>a<br>b</p>`);
    // offset=1 → the caret is between 'a' and '<br>'.
    const pt = domPointFromPosition([host], registry, { block: registry.refAt(0), offset: 1 });
    expect(pt?.node.nodeType).toBe(Node.TEXT_NODE);
    expect((pt?.node as Text).data).toBe("a");
    expect(pt?.offset).toBe(1);

    const pt2 = domPointFromPosition([host], registry, { block: registry.refAt(0), offset: 2 });
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
    const { host, registry } = setupHost(`<p>hi</p>`);
    const pt = domPointFromPosition([host], registry, { block: registry.refAt(0), offset: 10 });
    expect(pt?.node).toBe(host.querySelector("p"));
    expect(pt?.offset).toBe(host.querySelector("p")!.childNodes.length);
  });
});

describe("rangeFromDomRange", () => {
  it("round-trips a DOM range into an API range", () => {
    const { host, registry } = setupHost(`<p>hello world</p>`);
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
    const { host, registry } = setupHost(`<p>foo</p><p>bar</p>`);
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
