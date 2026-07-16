import { describe, expect, it } from "vitest";

import { emptyDocument, paragraph, text } from "../../../doc/builders";
import type { SobreeDocument } from "../../../doc/types";
import { patchChangedBlocksInPlace } from "./incrementalPatch";
import { renderSobreeDocument } from "./index";

const doc = window.document;

function docOf(...lines: string[]): { document: SobreeDocument; ids: string[] } {
  const d = emptyDocument();
  d.body = lines.map((t) => paragraph([text(t)]));
  const ids = lines.map((_, i) => `b${i}`);
  return { document: d, ids };
}

/** Render `document` into one host, then move `moveIndices` blocks into a
 *  second host — a stand-in for the paginator distributing blocks across
 *  papers. Returns both hosts. */
function renderDistributed(
  document: SobreeDocument,
  ids: string[],
  moveIndices: number[],
): [HTMLElement, HTMLElement] {
  const host1 = doc.createElement("div");
  const host2 = doc.createElement("div");
  renderSobreeDocument(document, host1, ids);
  for (const i of moveIndices) {
    const el = host1.querySelector(`[data-block-id="${ids[i]}"]`);
    if (el) host2.appendChild(el);
  }
  return [host1, host2];
}

/** The one live element carrying `id` across hosts. */
function liveEl(hosts: HTMLElement[], id: string): HTMLElement | null {
  for (const h of hosts) {
    const el = h.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
    if (el) return el;
  }
  return null;
}

describe("patchChangedBlocksInPlace", () => {
  it("morphs a changed block in place across papers, preserving its node reference", () => {
    const { document, ids } = docOf("alpha", "beta", "gamma", "delta");
    const hosts = renderDistributed(document, ids, [2, 3]); // gamma, delta on host2
    const before = liveEl(hosts, "b2");
    const otherBefore = liveEl(hosts, "b0");

    // Edit gamma's text (a run-level change: block attributes unchanged).
    (document.body[2] as { runs: unknown[] }).runs = [text("gamma edited")];

    const ok = patchChangedBlocksInPlace(document, hosts, ids, new Set(["b2"]));
    expect(ok).toBe(true);

    const after = liveEl(hosts, "b2");
    // Same node reference (morphed in place), new content.
    expect(after).toBe(before);
    expect(after?.textContent).toBe("gamma edited");
    // On host2, untouched by the edit to a sibling.
    expect(after?.parentElement).toBe(hosts[1]);
    // An unchanged block is completely untouched.
    expect(liveEl(hosts, "b0")).toBe(otherBefore);
  });

  it("produces a node byte-identical to a full render of the edited doc", () => {
    const { document, ids } = docOf("one", "two", "three");
    const hosts = renderDistributed(document, ids, [2]);
    (document.body[1] as { runs: unknown[] }).runs = [text("two changed")];
    patchChangedBlocksInPlace(document, hosts, ids, new Set(["b1"]));

    const fresh = doc.createElement("div");
    renderSobreeDocument(document, fresh, ids);
    const expected = fresh.querySelector('[data-block-id="b1"]') as HTMLElement;
    expect(liveEl(hosts, "b1")?.outerHTML).toBe(expected.outerHTML);
  });

  it("bails (returns false) when a changed block is split across papers", () => {
    const { document, ids } = docOf("alpha", "beta");
    const [host1, host2] = renderDistributed(document, ids, []);
    // Simulate a split fragment: the same block id appears in both hosts.
    const frag = host1.querySelector('[data-block-id="b0"]')!.cloneNode(true) as HTMLElement;
    host2.appendChild(frag);
    (document.body[0] as { runs: unknown[] }).runs = [text("alpha edited")];

    expect(patchChangedBlocksInPlace(document, [host1, host2], ids, new Set(["b0"]))).toBe(false);
  });

  it("bails (returns false) when a changed block is missing from the live DOM", () => {
    const { document, ids } = docOf("alpha", "beta");
    const [host1] = renderDistributed(document, ids, []);
    expect(patchChangedBlocksInPlace(document, [host1], ids, new Set(["nope"]))).toBe(false);
  });
});
