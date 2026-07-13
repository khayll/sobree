import { describe, expect, it } from "vitest";
import type { InlinePosition } from "../doc/api";
import { emptyDocument, paragraph, text } from "../doc/builders";
import type { SobreeDocument } from "../doc/types";
import { Editor } from "./";
import type { EditorContext } from "./context";
import * as runs from "./ops/runs";

/**
 * Perf bench / fitness baseline for the model-first editing work
 * (`devdocs/plan-model-first-editing.md`, Stage 1 — incremental render).
 *
 * It measures a DETERMINISTIC proxy for render cost — how many block DOM
 * elements a single-block edit RE-CREATES vs reuses — by comparing element
 * identity across the re-render. Wall-clock timing would be flaky in CI;
 * node identity is exact.
 *
 * TODAY: an API edit runs `renderSobreeDocument` → `host.replaceChildren()`,
 * so EVERY block's DOM node is rebuilt (0 reused). This test pins that
 * baseline. When incremental render lands, a one-block edit must reuse every
 * OTHER block's node (reused === N − 1); flip the assertion then — that's the
 * whole point of the milestone, and this test is its guard.
 */

const N = 25;

function longDoc(): SobreeDocument {
  const d = emptyDocument();
  d.body = Array.from({ length: N }, (_, i) => paragraph([text(`Paragraph number ${i}.`)]));
  return d;
}

/** `data-block-id` → its rendered element, across all content hosts. */
function blockEls(ed: Editor): Map<string, Element> {
  const host = (ed as unknown as { host: HTMLElement }).host;
  const map = new Map<string, Element>();
  for (const el of host.querySelectorAll("[data-block-id]")) {
    const id = el.getAttribute("data-block-id");
    // Only top-level blocks (a table cell's paragraphs also carry the attr).
    if (id && !map.has(id)) map.set(id, el);
  }
  return map;
}

describe("render node reuse across an edit (Stage-1 baseline)", () => {
  it("a single-block edit currently rebuilds every block node (0 reused)", () => {
    const ed = new Editor(document.createElement("div"), { initialDocument: longDoc() });
    document.body.appendChild((ed as unknown as { host: HTMLElement }).host);

    const before = blockEls(ed);
    expect(before.size).toBe(N);

    // Edit ONE block through the API (the path that re-renders): insert a run
    // into block 12.
    const target = ed.getBlock(12);
    const at: InlinePosition = {
      block: { id: target.id, version: target.version },
      offset: 0,
    };
    const ctx = (ed as unknown as { ctx: EditorContext }).ctx;
    const res = runs.insertRun(ctx, at, { kind: "text", text: "X", properties: {} });
    expect(res.ok).toBe(true);

    const after = blockEls(ed);
    let reused = 0;
    for (const [id, el] of before) if (after.get(id) === el) reused += 1;

    // BASELINE (full rebuild). Incremental render flips this to N − 1.
    expect(reused).toBe(0);

    // The edited block's text did change (sanity: the edit landed).
    expect(ed.getBlock(12).text.startsWith("X")).toBe(true);
    ed.destroy();
  });
});
